import { formatMonthLabel } from "@/lib/dates";
import { isValidMonthKey } from "@/lib/month-context";

/**
 * The app-wide reporting period: either ALL TIME, or an inclusive From–To
 * span of months. Persisted as a cookie pair and shared by the Dashboard,
 * the Ledger Overview and the Billed drill-down.
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

/** Cookie value meaning "all time". Not a valid month key, so an older
 * build reading this cookie falls through to its own default rather than
 * rendering a garbage range. */
export const ALL_TIME_COOKIE_VALUE = "ALL";

/**
 * The lower bound used for all-time queries.
 *
 * Month keys are compared as plain strings everywhere in the engine
 * (`monthKey: { $gte: from }`), and "0000-01" sorts before every real
 * "YYYY-MM" — so all-time needs no special-casing in a single aggregation
 * pipeline, and "everything strictly before all-time" is correctly empty.
 * It must never be handed to formatMonthLabel/monthKeyToRange: use
 * `isAllTime` for anything that turns the period into a date or a label.
 */
export const ALL_TIME_FROM = "0000-01";

export type ResolvedPeriod = {
  /** ALL_TIME_FROM when `isAllTime` — safe to pass to any monthKey query. */
  from: string;
  to: string;
  isAllTime: boolean;
};

/**
 * Resolves the effective period for a render.
 *
 * With no cookies at all the answer is ALL TIME: a ledger's first useful
 * question is "what is the whole picture", and defaulting to the current
 * month made a freshly-opened app look empty on the 1st of a month, or hid
 * every figure a user had entered against an earlier one. Narrowing to a
 * month is an explicit choice, and it sticks once made.
 *
 * Falls back to a single-month range (from === to === fallback) whenever a
 * stored month pair is malformed or inverted.
 */
export function resolvePeriodRange(
  fromCookie: string | undefined,
  toCookie: string | undefined,
  fallback: string
): ResolvedPeriod {
  const allTime: ResolvedPeriod = { from: ALL_TIME_FROM, to: fallback, isAllTime: true };

  if (fromCookie === ALL_TIME_COOKIE_VALUE) return allTime;
  // Nothing stored yet — the default described above.
  if (fromCookie === undefined && toCookie === undefined) return allTime;

  const to = isValidMonthKey(toCookie) ? toCookie : fallback;
  const from = isValidMonthKey(fromCookie) ? fromCookie : to;
  if (from > to) return { from: to, to, isAllTime: false };
  return { from, to, isAllTime: false };
}

export const ALL_TIME_LABEL = "All time";

/** The one place a period turns into words, so the picker's trigger, the
 * section headings and the card labels can never describe the same cookie
 * differently. Never calls formatMonthLabel on an all-time `from` — that
 * value is the "0000-01" query floor, not a real month. */
export function formatPeriodRangeLabel(period: ResolvedPeriod): string {
  if (period.isAllTime) return ALL_TIME_LABEL;
  if (period.from === period.to) return formatMonthLabel(period.to);
  return `${formatMonthLabel(period.from)} – ${formatMonthLabel(period.to)}`;
}

export { isValidMonthKey };
