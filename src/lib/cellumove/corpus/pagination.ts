/** PostgREST caps a response at 1,000 rows, even when more rows match. */
export async function loadAllRows<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, pageSize = 500): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const result = await page(from, from + pageSize - 1);
    if (result.error) throw new Error(result.error.message);
    rows.push(...(result.data ?? []));
    if (!result.data || result.data.length < pageSize) return rows;
  }
}
