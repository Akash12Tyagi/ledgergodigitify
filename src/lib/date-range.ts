import { monthRangeToUtc, nowIST, shiftMonthKey, startOfDayIST, toMonthKey } from "@/lib/dates";
import type { OutsideWindowSummary } from "@/types/list";

/**
 * Exact-date filtering for LIST views (expenses, credits) — distinct from
 * the app-wide month period in lib/period-range-context.ts, and DEFAULTING
 * TO ALL TIME rather than inheriting it.
 *
 * Why two mechanisms rather than one: the Overview's money-math block
 * aggregates on `monthKey`, and a payment's monthKey is the month of the
 * BILLING it settles, not the day the cash arrived (financial-engine.ts,
 * Section 14 edge case 3). Filtering those figures by a day range would
 * change what they mean and break the opening + net = closing identity the
 * engine asserts. A list of rows has no such identity to preserve, so it can
 * filter on the real date and does — or on nothing at all, which is the
 * default: a list that hides rows it was never asked to hide reads as a bug,
 * not as a filter.
 *
 * These live in the QUERY STRING rather than a cookie: a date range is a
 * property of the list you are looking at, not a global mode, and should
 * survive being shared as a link without leaking into every other screen.
 */
export const DATE_FROM_PARAM = "from";
export const DATE_TO_PARAM = "to";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidISODate(value: string | undefined): value is string {
  if (!value || !ISO_DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000+05:30`);
  if (Number.isNaN(parsed.getTime())) return false;
  // Rejects the likes of 2026-02-31, which Date happily rolls into March.
  return toISODateIST(parsed) === value;
}

/** "YYYY-MM-DD" as read in IST, the timezone every date in this app means. */
export function toISODateIST(d: Date): string {
  const istMs = d.getTime() + 5.5 * 60 * 60 * 1000;
  const ist = new Date(istMs);
  const year = ist.getUTCFullYear();
  const month = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const day = String(ist.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** "23 Apr 2026" for an IST "YYYY-MM-DD" — the display form shared by the
 * range picker's trigger and the empty states that have to name a range. */
export function formatISODateDisplay(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00.000+05:30`).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

/** A repository's $min/$max instants → the IST dates the empty state names
 * and jumps to. Shared by every list that reports what its window hid. */
export function toOutsideWindowSummary(
  summary: { total: number; earliest: Date; latest: Date } | null
): OutsideWindowSummary | null {
  if (!summary) return null;
  return {
    total: summary.total,
    earliest: toISODateIST(summary.earliest),
    latest: toISODateIST(summary.latest),
  };
}

/** What the picker's trigger and the empty states call the current scope. */
export const ALL_TIME_LABEL = "All time";

export type ResolvedDateRange = {
  /** Inclusive start, as the UTC instant of IST midnight. `undefined` means
   * the window is open at this end — no lower bound is applied. */
  startUTC: Date | undefined;
  /** EXCLUSIVE end — the instant IST midnight begins on the day AFTER `to`,
   * so a single-day range still contains that whole day. Every consumer
   * compares with `$gte startUTC, $lt endUTC`. `undefined` leaves the window
   * open at this end. */
  endUTC: Date | undefined;
  /** Echoed back for the picker; null on the open end of a window. */
  from: string | null;
  to: string | null;
  /** False on All time — nothing is being filtered out. */
  isFiltered: boolean;
};

/**
 * Nothing given means ALL TIME: no window, every record.
 *
 * This used to fall back to the app-wide month period, which made narrowing
 * the default — a backdated entry vanished the instant it was saved, and an
 * empty list was indistinguishable from a failed save. A list's job is to
 * hold the records; narrowing is now something you ask for, never something
 * you get by accident. The aggregate screens (Dashboard, Ledger Overview,
 * Billed) keep the month period, because their money math is defined per
 * month and an unbounded span would change what those figures mean.
 *
 * One bound alone is a legitimate half-open request ("everything since
 * 1 April") and stays open at the other end. An inverted pair is swapped
 * rather than rejected — the user clearly meant the span between the two.
 */
export function resolveDateRange(
  fromParam: string | undefined,
  toParam: string | undefined
): ResolvedDateRange {
  const hasFrom = isValidISODate(fromParam);
  const hasTo = isValidISODate(toParam);

  if (!hasFrom && !hasTo) {
    return { startUTC: undefined, endUTC: undefined, from: null, to: null, isFiltered: false };
  }

  if (hasFrom && !hasTo) {
    return {
      startUTC: istMidnightOf(fromParam),
      endUTC: undefined,
      from: fromParam,
      to: null,
      isFiltered: true,
    };
  }

  if (!hasFrom && hasTo) {
    return {
      startUTC: undefined,
      endUTC: exclusiveEndOf(toParam),
      from: null,
      to: toParam,
      isFiltered: true,
    };
  }

  let from = fromParam as string;
  let to = toParam as string;
  if (from > to) [from, to] = [to, from];

  return {
    startUTC: istMidnightOf(from),
    endUTC: exclusiveEndOf(to),
    from,
    to,
    isFiltered: true,
  };
}

/**
 * How a resolved window reads in a sentence — the picker's trigger, the
 * page header, and the "your filter hid these" empty state all name the
 * scope with this, so they can never describe it three different ways.
 */
export function describeDateWindow(from: string | null, to: string | null): string {
  if (from && to) return `${formatISODateDisplay(from)} – ${formatISODateDisplay(to)}`;
  if (from) return `Since ${formatISODateDisplay(from)}`;
  if (to) return `Until ${formatISODateDisplay(to)}`;
  return ALL_TIME_LABEL;
}

/** IST midnight on `isoDate` — the inclusive lower bound. */
function istMidnightOf(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000+05:30`);
}

/** IST midnight of the day after `isoDate` — the exclusive upper bound. */
function exclusiveEndOf(isoDate: string): Date {
  const start = istMidnightOf(isoDate);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000);
}

export type DatePreset = {
  id: string;
  label: string;
  /** Both inclusive, in IST "YYYY-MM-DD". */
  range: () => { from: string; to: string };
};

/**
 * Quick spans, in the order people actually reach for them. Every one is
 * computed at click time from `nowIST()` so a tab left open overnight does
 * not hand back yesterday's idea of "this month".
 */
export const DATE_PRESETS: DatePreset[] = [
  {
    id: "today",
    label: "Today",
    range: () => {
      const today = toISODateIST(nowIST());
      return { from: today, to: today };
    },
  },
  {
    id: "last7",
    label: "Last 7 days",
    range: () => ({ from: toISODateIST(daysAgo(6)), to: toISODateIST(nowIST()) }),
  },
  {
    id: "last30",
    label: "Last 30 days",
    range: () => ({ from: toISODateIST(daysAgo(29)), to: toISODateIST(nowIST()) }),
  },
  {
    id: "thisMonth",
    label: "This month",
    range: () => {
      const { startUTC } = monthRangeToUtc(toMonthKey(nowIST()), toMonthKey(nowIST()));
      return { from: toISODateIST(startUTC), to: toISODateIST(nowIST()) };
    },
  },
  {
    id: "lastMonth",
    label: "Last month",
    range: () => {
      // shiftMonthKey, not Date#setMonth: subtracting a month from 31 March
      // gives "31 February", which rolls forward into March and would hand
      // back the current month as "last month".
      const key = shiftMonthKey(toMonthKey(nowIST()), -1);
      const { startUTC, endUTC } = monthRangeToUtc(key, key);
      return { from: toISODateIST(startUTC), to: toISODateIST(new Date(endUTC.getTime() - 1)) };
    },
  },
  {
    id: "thisYear",
    label: "This year",
    range: () => {
      const now = nowIST();
      const year = Number(toMonthKey(now).slice(0, 4));
      return { from: `${year}-01-01`, to: toISODateIST(now) };
    },
  },
];

function daysAgo(n: number): Date {
  return startOfDayIST(new Date(nowIST().getTime() - n * 24 * 60 * 60 * 1000));
}
