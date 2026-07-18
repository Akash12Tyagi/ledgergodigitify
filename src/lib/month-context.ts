// Section 3/7.1 — the active-month context shared across /dashboard and
// /ledger/overview, persisted as a cookie (the SSR source of truth for
// which monthKey a page's composed data call uses) and mirrored into a
// Zustand slice for instant client-side UI (components/shared/month-store.ts).
export const MONTH_COOKIE = "activeMonthKey";

const MONTH_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isValidMonthKey(value: string | undefined | null): value is string {
  return typeof value === "string" && MONTH_KEY_PATTERN.test(value);
}

/** Resolves the effective monthKey for a page render: the cookie value if
 * present and well-formed, else `fallback` (normally toMonthKey(nowIST())). */
export function resolveMonthKey(cookieValue: string | undefined, fallback: string): string {
  return isValidMonthKey(cookieValue) ? cookieValue : fallback;
}
