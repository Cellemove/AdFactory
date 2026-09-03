import assert from "node:assert/strict";
import test from "node:test";
import { rankScriptBrollCandidates, type ScriptBrollCandidate } from "./script-broll";

const clips: ScriptBrollCandidate[] = [
  { id: "exact", name: "Fabric demo", url: null, folderPath: "UGC", description: "Close-up hand stretches textured purple compression leggings fabric", tags: "fabric texture stretch compression leggings" },
  { id: "recent", name: "Recent fabric demo", url: null, folderPath: "UGC", description: "Close-up hand stretches textured compression leggings fabric", tags: "fabric texture stretch compression leggings" },
  { id: "generic", name: "Packing orders", url: null, folderPath: "Warehouse", description: "Packages and shipping labels stacked on a warehouse table", tags: "shipping warehouse orders" },
];

test("filters candidates below the balanced semantic threshold", () => {
  const ranked = rankScriptBrollCandidates({
    query: { moduleId: "proof", text: "Show a close-up stretch demonstration of the compression fabric texture" },
    candidates: clips,
    semanticScores: [0.78, 0.76, 0.31],
    recentSuggestionCounts: new Map(),
    excludedClipIds: new Set(),
  });
  assert.deepEqual(ranked.map((item) => item.clip.id), ["exact", "recent"]);
});

test("soft recent-use penalty changes close rankings without overriding relevance threshold", () => {
  const ranked = rankScriptBrollCandidates({
    query: { moduleId: "proof", text: "Show a close-up stretch demonstration of the compression fabric texture" },
    candidates: clips.slice(0, 2),
    semanticScores: [0.78, 0.76],
    recentSuggestionCounts: new Map([["exact", 4]]),
    excludedClipIds: new Set(),
  });
  assert.equal(ranked[0]?.clip.id, "recent");
  assert.ok(ranked.some((item) => item.clip.id === "exact"));
});

test("never returns a clip already selected elsewhere in the script", () => {
  const ranked = rankScriptBrollCandidates({
    query: { moduleId: "proof", text: "compression leggings fabric" },
    candidates: clips,
    semanticScores: [0.8, 0.79, 0.2],
    recentSuggestionCounts: new Map(),
    excludedClipIds: new Set(["exact"]),
  });
  assert.deepEqual(ranked.map((item) => item.clip.id), ["recent"]);
});

