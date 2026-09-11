/**
 * Runs a Milanote "Export as PDF" through the same geometric parser the
 * evidence drawer uses, and prints what would land in "Exact script text".
 *
 *   npm run scorer:extract-milanote -- "C:/path/to/board.pdf"
 *   npm run scorer:extract-milanote -- board.pdf --blocks           # also list every column/note found
 *   npm run scorer:extract-milanote -- board.pdf --deconstruction   # also print the Deconstruction column
 */
import { readFile } from "node:fs/promises";
import { readMilanoteBoard } from "../src/lib/cellumove/milanote-board-pdf";
import { selectScriptSections } from "../src/lib/cellumove/milanote-board";
import { buildMilanoteScriptText, normalizeMilanoteExtraction } from "../src/lib/cellumove/milanote-script-extraction";

async function main(): Promise<void> {
  const [path, ...flags] = process.argv.slice(2);
  if (!path) {
    console.error("Usage: npm run scorer:extract-milanote -- <board.pdf> [--blocks]");
    process.exitCode = 1;
    return;
  }

  const blocks = await readMilanoteBoard(new Uint8Array(await readFile(path)));
  if (flags.includes("--blocks")) {
    for (const block of blocks) {
      const { x0, y0 } = block.bounds;
      console.log(`[page ${block.page} @ ${Math.round(x0)},${Math.round(y0)}] ${block.title}  (${block.cards.length} card${block.cards.length === 1 ? "" : "s"})`);
    }
    console.log("");
  }

  const selection = selectScriptSections(blocks);
  const extraction = normalizeMilanoteExtraction({ sections: selection.sections, excludedLabels: selection.excludedLabels });
  console.log(`Sections: ${extraction.sections.map((section) => section.label).join(", ")}`);
  console.log(`Excluded: ${extraction.excludedLabels.join(" | ") || "(none)"}`);
  const deconstruction = selection.deconstruction;
  console.log(`Deconstruction: ${deconstruction ? `"${deconstruction.label}" (${deconstruction.content.length} chars)` : "(none)"}`);
  console.log("");
  console.log(buildMilanoteScriptText(extraction));
  if (deconstruction && flags.includes("--deconstruction")) {
    console.log("");
    console.log(`## ${deconstruction.label}`);
    console.log(deconstruction.content);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
