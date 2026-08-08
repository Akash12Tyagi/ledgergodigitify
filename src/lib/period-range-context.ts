import { isValidMonthKey } from "@/lib/month-context";

/**
 * The app-wide reporting period: an inclusive From–To span of months,
 * persisted as a cookie pair and shared by the Dashboard, the Ledger
 * Overview and the Billed drill-down.
 *
 * There used to be two competing notions of "the period being viewed" — a
 * single `MONTH_COOKIE` driving the Ledger and this pair driving the
 * Dashboard — so moving the Dashboard to June while the Ledger stayed on
 * August was not just possible but the default after any navigation. One
 * source of truth removes the whole class of "these two screens disagree"
 * bugs rather than fixing them one at a time.
 *
 * The cookie NAMES are unchanged from when this was Dashboard-only, so an
 * existing session keeps whatever range it had selected.
 */
export const PERIOD_FROM_COOKIE = "dashboardFromMonthKey";
export const PERIOD_TO_COOKIE = "dashboardToMonthKey";

export { isValidMonthKey };

/**
 * Resolves the effective {from, to} for a render. Falls back to a
 * single-month range (from === to === fallback) whenever either cookie is
 * missing, malformed, or inverted — the default "just show me the current
 * month" view.
 */
export function resolvePeriodRange(
  fromCookie: string | undefined,
  toCookie: string | undefined,
  fallback: string
): { from: string; to: string } {
  const to = isValidMonthKey(toCookie) ? toCookie : fallback;
  const from = isValidMonthKey(fromCookie) ? fromCookie : to;
  if (from > to) return { from: to, to };
  return { from, to };
}
