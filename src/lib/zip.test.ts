import assert from "node:assert/strict";
import test from "node:test";
import { inflateRawSync } from "node:zlib";
import { createZip } from "./zip";

/** Read an archive back through its central directory, the way an unzip tool does. */
function readZip(zip: Buffer): Map<string, string> {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.notEqual(end, -1, "no end-of-central-directory record");
  const count = zip.readUInt16LE(end + 10);
  let cursor = zip.readUInt32LE(end + 16);
  const files = new Map<string, string>();
  for (let index = 0; index < count; index += 1) {
    assert.equal(zip.readUInt32LE(cursor), 0x02014b50);
    const compressed = zip.readUInt32LE(cursor + 20);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const localOffset = zip.readUInt32LE(cursor + 42);
    const name = zip.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    assert.equal(zip.readUInt32LE(localOffset), 0x04034b50);
    const dataStart = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
    files.set(name, inflateRawSync(zip.subarray(dataStart, dataStart + compressed)).toString("utf8"));
    cursor += 46 + nameLength;
  }
  return files;
}

test("a zip of several files reads back byte for byte, including non-ASCII and folders", () => {
  const big = JSON.stringify({ beats: Array.from({ length: 400 }, (_, index) => ({ index, quote: "legs feel heavy — “every” day" })) });
  const zip = createZip([
    { path: "index.json", content: "{\"ads\":2}" },
    { path: "getionix.com/cad_1.json", content: big },
    { path: "\\prefixskin.com\\cad_2.json", content: "{\"name\":\"Crème · été\"}" },
  ]);
  const files = readZip(zip);
  assert.deepEqual([...files.keys()], ["index.json", "getionix.com/cad_1.json", "prefixskin.com/cad_2.json"]);
  assert.equal(files.get("getionix.com/cad_1.json"), big);
  assert.equal(files.get("prefixskin.com/cad_2.json"), "{\"name\":\"Crème · été\"}");
  assert.ok(zip.length < big.length, "entries are compressed");
});

test("an empty archive is still a valid zip", () => {
  assert.equal(readZip(createZip([])).size, 0);
});
