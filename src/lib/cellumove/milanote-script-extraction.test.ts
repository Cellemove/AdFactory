import assert from "node:assert/strict";
import { test } from "node:test";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { assembleBoardText, buildBoardBlocks, selectScriptSections, type BoardRect, type BoardTextItem } from "./milanote-board";
import { readMilanoteBoard } from "./milanote-board-pdf";
import { buildMilanoteScriptText, isPdfBytes, normalizeMilanoteExtraction } from "./milanote-script-extraction";

const PROMPT_LINE = "You are a world-class creative strategist. Your objective is to create highly converting ad concepts.";

/**
 * Builds a board the way Milanote's PDF export draws one: every column and note
 * is a stroked rectangle, cards are nested rectangles, and the column title sits
 * above the first card. Coordinates are pdf-lib's (origin bottom-left).
 */
async function buildBoardPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([1400, 900]);

  // Far-left system prompt note (no cards).
  note(page, font, { x: 20, y: 100, w: 200, h: 780 }, ["SYSTEM PROMPT — CREATIVE STRATEGIST", PROMPT_LINE, "Return only JSON."]);
  // Research column with one card.
  column(page, font, { x: 260, y: 300, w: 200, h: 500 }, "Deconstruction of the ads", [
    ["BASIC AD INFORMATION", "An exhaustive deconstruction of the reference video."],
  ]);
  // Final deliverable: BODY column with two beats, then hook columns.
  column(page, font, { x: 520, y: 200, w: 200, h: 600 }, "BODY", [
    ["BEAT 1 | NEGATIVE HOOK (0:00 to 0:03)", 'VO: "Three reasons I regret buying the', 'CelluMove leggings."'],
    ["BEAT 2 | REGRET ONE (0:03 to 0:09)", 'VO: "One. They proved me wrong."'],
  ]);
  column(page, font, { x: 780, y: 500, w: 200, h: 300 }, "HOOK 1", [
    ["HOOK 1 — The Easy Put On", "VISUAL: She is sat on the edge of the", "bed, already halfway in.", "ASSET NEEDED: UGC b-roll pack."],
    ["Caption warning in red, try both"],
  ]);
  column(page, font, { x: 1040, y: 500, w: 200, h: 300 }, "HOOK 2", [
    // A prompt-shaped card hiding inside a script column: must be caught by the content guard.
    ["HOOK 2 — Mislabeled", PROMPT_LINE],
  ]);
  // Stand-alone hook note (no cards) to cover the note-shaped deliverable.
  note(page, font, { x: 1040, y: 100, w: 200, h: 300 }, ["HOOK 3 — The Sock Mark", "VISUAL: Evening. She is on the sofa."]);

  return pdf.save();
}

type Box = { x: number; y: number; w: number; h: number };

function note(page: PDFPage, font: PDFFont, box: Box, lines: string[]): void {
  page.drawRectangle({ x: box.x, y: box.y, width: box.w, height: box.h, borderColor: rgb(0, 0, 0), borderWidth: 1 });
  writeLines(page, font, box.x + 8, box.y + box.h - 20, lines);
}

function column(page: PDFPage, font: PDFFont, box: Box, title: string, cards: string[][]): void {
  page.drawRectangle({ x: box.x, y: box.y, width: box.w, height: box.h, borderColor: rgb(0, 0, 0), borderWidth: 1 });
  page.drawText(title, { x: box.x + 8, y: box.y + box.h - 24, size: 10, font });
  let top = box.y + box.h - 44;
  for (const lines of cards) {
    const height = 16 + lines.length * 14;
    page.drawRectangle({ x: box.x + 5, y: top - height, width: box.w - 10, height, borderColor: rgb(0, 0, 0), borderWidth: 1, color: rgb(1, 1, 1) });
    writeLines(page, font, box.x + 12, top - 16, lines);
    top -= height + 6;
  }
}

function writeLines(page: PDFPage, font: PDFFont, x: number, firstBaseline: number, lines: string[]): void {
  lines.forEach((line, index) => page.drawText(line, { x, y: firstBaseline - index * 14, size: 8, font }));
}

test("Milanote PDF export is read by column geometry: script columns in, everything else out", async () => {
  const bytes = await buildBoardPdf();
  const blocks = await readMilanoteBoard(bytes);

  assert.deepEqual(
    blocks.map((block) => block.title),
    ["SYSTEM PROMPT — CREATIVE STRATEGIST", "Deconstruction of the ads", "BODY", "HOOK 1", "HOOK 2", "HOOK 3 — The Sock Mark"],
  );
  assert.equal(blocks.find((block) => block.header === "BODY")?.cards.length, 2);

  const selection = selectScriptSections(blocks);
  assert.deepEqual(selection.sections.map((section) => section.label), ["HOOK 1", "HOOK 2", "HOOK 3 — The Sock Mark", "BODY"]);
  assert.deepEqual(selection.excludedLabels, ["SYSTEM PROMPT — CREATIVE STRATEGIST"]);

  // The deconstruction column is kept verbatim as its own evidence field, never as script.
  assert.deepEqual(selection.deconstruction, {
    label: "Deconstruction of the ads",
    content: "BASIC AD INFORMATION\nAn exhaustive deconstruction of the reference video.",
  });

  const body = selection.sections.find((section) => section.label === "BODY")!;
  assert.equal(
    body.content,
    'BEAT 1 | NEGATIVE HOOK (0:00 to 0:03)\nVO: "Three reasons I regret buying the CelluMove leggings."\n\nBEAT 2 | REGRET ONE (0:03 to 0:09)\nVO: "One. They proved me wrong."',
  );
  const hook1 = selection.sections.find((section) => section.label === "HOOK 1")!;
  assert.equal(
    hook1.content,
    "HOOK 1 — The Easy Put On\nVISUAL: She is sat on the edge of the bed, already halfway in.\nASSET NEEDED: UGC b-roll pack.\n\nCaption warning in red, try both",
  );
  assert.doesNotMatch(JSON.stringify(selection.sections.filter((s) => s.label !== "HOOK 2")), /world-class|Your objective|deconstruction of the reference/i);

  // The prompt-shaped card inside the HOOK 2 column survives geometry but not the content guard.
  const extraction = normalizeMilanoteExtraction({ sections: selection.sections, excludedLabels: selection.excludedLabels });
  assert.deepEqual(extraction.sections.map((section) => section.label), ["HOOK 1", "HOOK 3 — The Sock Mark", "BODY"]);
  assert.doesNotMatch(buildMilanoteScriptText(extraction), /world-class|Your objective/i);
  assert.match(buildMilanoteScriptText(extraction), /^## HOOK 1\nHOOK 1 — The Easy Put On/);
});

test("system prompts and planning cards are removed from extracted script sections", () => {
  const extraction = normalizeMilanoteExtraction({
    sections: [
      { label: "SYSTEM PROMPT — CREATIVE STRATEGIST", content: "You are a world-class creative strategist." },
      { label: "Marketing information", content: "Avatar research goes here." },
      { label: "HOOK 1", content: 'HOOK 1\nVO: "Three reasons I regret buying these leggings."' },
      { label: "BODY", content: "VISUAL: She pulls the leggings over her heel." },
    ],
    excludedLabels: ["H", "SYSTEM PROMPT", "Marketing information"],
  });

  assert.deepEqual(extraction.sections.map((section) => section.label), ["HOOK 1", "BODY"]);
  assert.deepEqual(extraction.excludedLabels, ["SYSTEM PROMPT", "Marketing information"]);
  assert.equal(
    buildMilanoteScriptText(extraction),
    '## HOOK 1\nVO: "Three reasons I regret buying these leggings."\n\n## BODY\nVISUAL: She pulls the leggings over her heel.',
  );
});

test("prompt text is rejected even when mislabeled as a script card", () => {
  assert.throws(() => normalizeMilanoteExtraction({
    sections: [{ label: "HOOK 1", content: "Your objective is to create highly converting ad concepts." }],
    excludedLabels: [],
  }), /No final script sections remained/);
});

test("soft-wrapped lines are joined, real line breaks and field labels are kept", () => {
  // Card 100pt wide; glyph runs are 5pt per character at size 8.
  const items: BoardTextItem[] = [];
  const line = (y: number, text: string) => items.push({ str: text, x: 10, y, size: 8, width: text.length * 5 });
  line(20, "VO: This line fills the");   // 23 chars → right edge 125 (the max)
  line(32, "card completely.");           // "card" (20pt) would not have fit → wrapped
  line(44, "VISUAL: short line");          // starts a field → never joined
  line(56, "ends here.");                  // short previous line → real break
  assert.equal(assembleBoardText(items), "VO: This line fills the card completely.\nVISUAL: short line\nends here.");
});

test("cards are assigned to the innermost column and headers exclude card text", () => {
  const column: BoardRect = { x0: 0, y0: 0, x1: 200, y1: 300 };
  const card: BoardRect = { x0: 5, y0: 40, x1: 195, y1: 120 };
  const items: BoardTextItem[] = [
    { str: "HOOK 1", x: 10, y: 20, size: 10, width: 40 },
    { str: "VO: hello", x: 10, y: 60, size: 8, width: 45 },
  ];
  const blocks = buildBoardBlocks([column, card, card], items, 1);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]!.header, "HOOK 1");
  assert.deepEqual(blocks[0]!.cards.map((c) => c.text), ["VO: hello"]);
});

test("PDF uploads are checked by file signature rather than browser MIME alone", () => {
  assert.equal(isPdfBytes(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])), true);
  assert.equal(isPdfBytes(new TextEncoder().encode("<html>login wall</html>")), false);
});

test("boards without a deconstruction column report null instead of an empty field", () => {
  const rects: BoardRect[] = [{ x0: 0, y0: 0, x1: 200, y1: 100 }, { x0: 5, y0: 30, x1: 195, y1: 90 }];
  const items: BoardTextItem[] = [
    { str: "HOOK 1", x: 8, y: 20, size: 10, width: 40 },
    { str: "VO: hello", x: 10, y: 45, size: 8, width: 40 },
  ];
  const selection = selectScriptSections(buildBoardBlocks(rects, items, 1));
  assert.deepEqual(selection.sections, [{ label: "HOOK 1", content: "VO: hello" }]);
  assert.equal(selection.deconstruction, null);
  assert.deepEqual(selection.excludedLabels, []);
});
