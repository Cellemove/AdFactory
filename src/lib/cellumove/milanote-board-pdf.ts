/**
 * Reads a Milanote PDF export with pdf.js and hands the drawn rectangles and
 * positioned text runs to the pure board parser in `milanote-board.ts`.
 *
 * Node-only (pdf.js legacy build). Kept free of `server-only` so the tests can
 * run the whole pipeline against a synthetic board built with pdf-lib.
 */

import type { PDFPageProxy } from "pdfjs-dist";
import { type BoardBlock, type BoardRect, type BoardTextItem, buildBoardBlocks } from "@/lib/cellumove/milanote-board";

const MIN_RECT_WIDTH = 60;
const MIN_RECT_HEIGHT = 16;

type Matrix = [number, number, number, number, number, number];

type PdfjsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let pdfjsPromise: Promise<PdfjsModule> | null = null;

/**
 * Loads pdf.js with its worker running on the main thread. pdf.js normally
 * reaches the worker through `import(workerSrc)`, a dynamic path that serverless
 * bundlers cannot trace — on Vercel that surfaced as "Cannot find module
 * …/pdf.worker.mjs". Importing the worker with a literal specifier makes it part
 * of the deployed function, and registering its handler on
 * `globalThis.pdfjsWorker` makes pdf.js use it without any dynamic import.
 */
function loadPdfjs(): Promise<PdfjsModule> {
  pdfjsPromise ??= (async () => {
    const [pdfjs, worker] = await Promise.all([
      import("pdfjs-dist/legacy/build/pdf.mjs"),
      import("pdfjs-dist/legacy/build/pdf.worker.mjs"),
    ]);
    (globalThis as { pdfjsWorker?: { WorkerMessageHandler: unknown } }).pdfjsWorker = { WorkerMessageHandler: worker.WorkerMessageHandler };
    return pdfjs;
  })();
  return pdfjsPromise;
}

export async function readMilanoteBoard(bytes: Uint8Array): Promise<BoardBlock[]> {
  const pdfjs = await loadPdfjs();
  const document = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: false }).promise;
  try {
    const blocks: BoardBlock[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const pageHeight = page.view[3]! - page.view[1]!;
      const rects = await readStrokedRects(page, pageHeight, pdfjs.OPS);
      const items = await readTextItems(page, pageHeight);
      blocks.push(...buildBoardBlocks(rects, items, pageNumber));
    }
    return blocks;
  } finally {
    await document.destroy();
  }
}

/** Walks the page's operator list and returns every stroked rectangle in top-left page coordinates. */
async function readStrokedRects(page: PDFPageProxy, pageHeight: number, OPS: Record<string, number>): Promise<BoardRect[]> {
  const operators = await page.getOperatorList();
  const rects: BoardRect[] = [];
  const stack: Matrix[] = [];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  let pending: BoardRect[] = [];

  // Polyline subpath being built with moveTo/lineTo (some producers draw
  // rectangles that way instead of with the `re` operator).
  let subpath: Array<[number, number]> = [];

  const pushCorners = (corners: Array<[number, number]>) => {
    const xs = corners.map(([x]) => x);
    const ys = corners.map(([, y]) => y);
    pending.push({
      x0: Math.min(...xs),
      x1: Math.max(...xs),
      y0: pageHeight - Math.max(...ys),
      y1: pageHeight - Math.min(...ys),
    });
  };
  const pushRect = (x: number, y: number, width: number, height: number) => {
    pushCorners([applyMatrix(ctm, x, y), applyMatrix(ctm, x + width, y + height)]);
  };
  const flushSubpath = () => {
    if (isAxisAlignedRectangle(subpath)) pushCorners(subpath);
    subpath = [];
  };

  for (let index = 0; index < operators.fnArray.length; index += 1) {
    const fn = operators.fnArray[index];
    const args = operators.argsArray[index] as unknown;
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = multiply(args as Matrix, ctm);
    else if (fn === OPS.rectangle) {
      const [x, y, width, height] = args as [number, number, number, number];
      pushRect(x, y, width, height);
    } else if (fn === OPS.constructPath) {
      const [pathOps, coords] = args as [number[], ArrayLike<number>];
      let cursor = 0;
      for (const op of pathOps) {
        if (op === OPS.rectangle) {
          flushSubpath();
          pushRect(coords[cursor]!, coords[cursor + 1]!, coords[cursor + 2]!, coords[cursor + 3]!);
          cursor += 4;
        } else if (op === OPS.moveTo) {
          flushSubpath();
          subpath.push(applyMatrix(ctm, coords[cursor]!, coords[cursor + 1]!));
          cursor += 2;
        } else if (op === OPS.lineTo) {
          subpath.push(applyMatrix(ctm, coords[cursor]!, coords[cursor + 1]!));
          cursor += 2;
        } else if (op === OPS.closePath) {
          flushSubpath();
        } else if (op === OPS.curveTo) { subpath = []; cursor += 6; }
        else if (op === OPS.curveTo2 || op === OPS.curveTo3) { subpath = []; cursor += 4; }
      }
    } else if (fn === OPS.stroke || fn === OPS.closeStroke || fn === OPS.fillStroke || fn === OPS.eoFillStroke) {
      flushSubpath();
      for (const rect of pending) {
        if (rect.x1 - rect.x0 >= MIN_RECT_WIDTH && rect.y1 - rect.y0 >= MIN_RECT_HEIGHT) rects.push(rect);
      }
      pending = [];
    } else if (fn === OPS.fill || fn === OPS.eoFill || fn === OPS.endPath || fn === OPS.clip || fn === OPS.eoClip) {
      pending = [];
      subpath = [];
    }
  }

  return rects;
}

/** Four (or five, when the first point is repeated) corners forming an axis-aligned rectangle. */
function isAxisAlignedRectangle(points: Array<[number, number]>): boolean {
  const corners = points.length === 5 && near(points[0]!, points[4]!) ? points.slice(0, 4) : points;
  if (corners.length !== 4) return false;
  for (let index = 0; index < 4; index += 1) {
    const [ax, ay] = corners[index]!;
    const [bx, by] = corners[(index + 1) % 4]!;
    const horizontal = Math.abs(ay - by) < 0.5 && Math.abs(ax - bx) >= 0.5;
    const vertical = Math.abs(ax - bx) < 0.5 && Math.abs(ay - by) >= 0.5;
    if (!horizontal && !vertical) return false;
  }
  return true;
}

function near(a: [number, number], b: [number, number]): boolean {
  return Math.abs(a[0] - b[0]) < 0.5 && Math.abs(a[1] - b[1]) < 0.5;
}

async function readTextItems(page: PDFPageProxy, pageHeight: number): Promise<BoardTextItem[]> {
  const content = await page.getTextContent();
  const items: BoardTextItem[] = [];
  for (const item of content.items) {
    if (!("str" in item)) continue;
    const [a, , , d, e, f] = item.transform as Matrix;
    const size = Math.hypot(a, d) || Math.abs(d) || 1;
    items.push({ str: item.str, x: e, y: pageHeight - f, size, width: item.width });
  }
  return items;
}

function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}

function applyMatrix(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}
