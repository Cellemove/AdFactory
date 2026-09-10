import "server-only";

import { readMilanoteBoard } from "@/lib/cellumove/milanote-board-pdf";
import { selectScriptSections } from "@/lib/cellumove/milanote-board";
import {
  buildMilanoteScriptText,
  isPdfBytes,
  MAX_MILANOTE_PDF_BYTES,
  normalizeMilanoteExtraction,
} from "@/lib/cellumove/milanote-script-extraction";

export type ExtractedMilanoteScript = {
  scriptText: string;
  sectionLabels: string[];
  excludedLabels: string[];
  /** Verbatim "Deconstruction of the ads" column, or null when the board has none. */
  deconstructionText: string | null;
  deconstructionLabel: string | null;
  /** How the script was read. Geometry-based extraction is deterministic: no model, no rewriting. */
  method: "pdf-geometry";
};

/**
 * Reads the final script (HOOK / BODY / SCRIPT / CTA columns) out of a Milanote
 * "Export as PDF". The board's system prompt, brief, research and deconstruction
 * columns are never read — the parser only opens columns whose title is a
 * script heading — so nothing can be rewritten, summarised or hallucinated.
 */
export async function extractMilanoteScriptFromPdf(file: File): Promise<ExtractedMilanoteScript> {
  if (file.size === 0) throw new Error("That Milanote PDF is empty.");
  if (file.size > MAX_MILANOTE_PDF_BYTES) throw new Error("Milanote PDF is too large (maximum 10 MB).");

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isPdfBytes(bytes)) throw new Error("The selected file is not a valid PDF.");

  let blocks;
  try {
    blocks = await readMilanoteBoard(bytes);
  } catch (error) {
    throw new Error(`Could not read the Milanote PDF: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!blocks.length) throw new Error("No Milanote cards or columns were found in this PDF. Export the board itself (Board menu → Export → PDF), not a screenshot.");

  const selection = selectScriptSections(blocks);
  if (!selection.sections.length) {
    const seen = selection.excludedLabels.slice(0, 6).join(", ");
    throw new Error(`No HOOK, BODY, SCRIPT or CTA column was found on this board.${seen ? ` Columns seen: ${seen}.` : ""} Title the final script columns HOOK 1/2/3 and BODY, then export again.`);
  }

  const extraction = normalizeMilanoteExtraction({ sections: selection.sections, excludedLabels: selection.excludedLabels });
  return {
    scriptText: buildMilanoteScriptText(extraction),
    sectionLabels: extraction.sections.map((section) => section.label),
    excludedLabels: extraction.excludedLabels,
    deconstructionText: selection.deconstruction?.content ?? null,
    deconstructionLabel: selection.deconstruction?.label ?? null,
    method: "pdf-geometry",
  };
}
