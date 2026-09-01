// Idea-bank domain constants. Pure (no imports, no side effects) so both the
// client table and the server actions can use it.
//
// These deliberately do NOT live in app/actions/bank.ts: that file is a
// "use server" module, and Next only permits async function exports there — a
// const array or a sync type guard exported from it fails the build with
// "Server Actions must be async functions".

export const BANK_STATUSES = ["new", "shortlisted", "used", "archived"] as const;
export type BankStatus = (typeof BANK_STATUSES)[number];

export function isBankStatus(value: string): value is BankStatus {
  return (BANK_STATUSES as readonly string[]).includes(value);
}
