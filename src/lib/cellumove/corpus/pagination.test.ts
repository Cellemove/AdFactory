import assert from "node:assert/strict";
import test from "node:test";
import { loadAllRows } from "./pagination";

test("all evidence is loaded beyond the database response cap", async () => {
  const evidence = Array.from({ length: 2103 }, (_, id) => ({ id }));
  const loaded = await loadAllRows(async (from, to) => ({ data: evidence.slice(from, to + 1), error: null }));
  assert.deepEqual(loaded, evidence);
  await assert.rejects(loadAllRows(async () => ({ data: null, error: { message: "offline" } })), /offline/);
});
