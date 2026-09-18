// Teardown's scene-by-scene script: the Timestamp | Visual | Audio | Text table
// the strategists work from.
//
// Deliberately separate from teardown.ts, which reaches for node:crypto to build
// ids — importing that from a browser component pulls Node-only code into the
// client bundle and the build fails. Everything here is client-safe.

import { z } from "zod";
import { ParsedTeardownWorkbookSchema } from "@/lib/cellumove/teardown-brief";

export const TeardownSceneSchema = z.object({
  timestamp: z.string(),
  visual: z.string(),
  audio: z.string(),
  overlays: z.string(),
});
export type TeardownScene = z.infer<typeof TeardownSceneSchema>;

/**
 * The workbook as Teardown returns it. The shared Script Studio schema predates
 * the script output and would strip the scenes, so the mirror keeps its own shape.
 */
export const MirroredWorkbookSchema = ParsedTeardownWorkbookSchema.extend({
  scenes: z.array(TeardownSceneSchema).optional(),
});

/** The scene table, or empty when this teardown predates the script output. */
export function workbookScenes(workbook: unknown): TeardownScene[] {
  const parsed = MirroredWorkbookSchema.safeParse(workbook);
  return parsed.success ? parsed.data.scenes ?? [] : [];
}

/** Tab-separated, so "Copy table" pastes straight into Sheets or Excel. */
export function scenesToTsv(scenes: TeardownScene[]): string {
  const needsQuoting = (value: string) => /[\t\n"]/.test(value);
  const cell = (value: string) => (needsQuoting(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const rows = [
    ["Timestamp", "Visual / Graphic Scene", "Audio / Voiceover", "Editing Cues & Text Overlays"],
    ...scenes.map((scene) => [scene.timestamp, scene.visual, scene.audio, scene.overlays]),
  ];
  return rows.map((row) => row.map(cell).join("\t")).join("\n");
}
