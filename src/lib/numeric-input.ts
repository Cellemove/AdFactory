export function normalizeUnsignedIntegerInput(value: string): string {
  return value.replace(/^0+(?=\d)/, "");
}
