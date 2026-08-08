// Month-key validation, shared by everything that reads a "YYYY-MM" from an
// untrusted source (cookies, query strings).
//
// This module used to also own MONTH_COOKIE and resolveMonthKey — a single
// active month that drove /ledger/overview while the Dashboard tracked its
// own From–To range. Two competing notions of "the period being viewed"
// meant the two screens routinely disagreed, so the app now has exactly one
// (lib/period-range-context.ts) and only the validator survives here.

const MONTH_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isValidMonthKey(value: string | undefined | null): value is string {
  return typeof value === "string" && MONTH_KEY_PATTERN.test(value);
}
