import { isValidMonthKey } from "@/lib/month-context";

// The Dashboard's From–To range state, persisted as its own pair of
// cookies — deliberately separate from MONTH_COOKIE (lib/month-context.ts),
// which stays a single monthKey and keeps driving /ledger/overview
// unchanged. Mirrored into a Zustand slice for instant client-side UI
// (components/shared/dashboard-range-store.ts).
export const DASHBOARD_FROM_COOKIE = "dashboardFromMonthKey";
export const DASHBOARD_TO_COOKIE = "dashboardToMonthKey";

export { isValidMonthKey };

/** Resolves the effective {from, to} range for a Dashboard render. Falls
 * back to a single-month range (from === to === fallback) whenever either
 * cookie is missing, malformed, or the pair is inverted (from > to) — the
 * default "just show me the current month" view. */
export function resolveDashboardRange(
  fromCookie: string | undefined,
  toCookie: string | undefined,
  fallback: string
): { from: string; to: string } {
  const to = isValidMonthKey(toCookie) ? toCookie : fallback;
  const from = isValidMonthKey(fromCookie) ? fromCookie : to;
  if (from > to) return { from: to, to };
  return { from, to };
}
