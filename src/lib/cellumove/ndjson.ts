export function parseNdjsonChunk<T>(buffer: string, chunk: string): { values: T[]; remainder: string } {
  const lines = `${buffer}${chunk}`.split("\n");
  const remainder = lines.pop() ?? "";
  const values = lines
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
  return { values, remainder };
}
