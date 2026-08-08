import { clampBillingDay, dayOfMonthIST, shiftMonthKey, toMonthKey } from "@/lib/dates";

/**
 * Billing periods — the unit a client is actually billed for.
 *
 * A period is NOT necessarily a calendar month. A client may be billed
 * 1st-to-1st, 20th-to-20th, or 7th-to-7th; the cycle is anchored on a
 * day-of-month (`anchorDay`, stored as `Client.billingDay`) and repeats
 * monthly from there.
 *
 * `periodStart` is inclusive, `periodEnd` is EXCLUSIVE — so consecutive
 * periods are exactly contiguous ([20 Aug, 20 Sep) then [20 Sep, 20 Oct))
 * with no shared day and no gap. Both are the UTC instant of IST midnight
 * on that calendar day, matching every other date in the app (lib/dates.ts).
 *
 * The anchor is always carried separately rather than re-derived from
 * `periodStart`, because a start date can be CLAMPED: an anchorDay of 31
 * produces a 28 Feb start in a common year, and the period after that must
 * return to 31 Mar — not stay stuck on the 28th. Deriving the anchor from a
 * clamped start would silently walk a client's billing date backwards over
 * time (the classic "end of month" recurrence bug).
 */
export type BillingPeriod = { periodStart: Date; periodEnd: Date };

/** The day-of-month a cycle repeats on, read in IST. Used when a client has
 * no explicit `billingDay` yet — the first period's start day becomes the
 * anchor for every period after it. */
export function anchorDayFrom(periodStart: Date): number {
  return dayOfMonthIST(periodStart);
}

/** The exclusive end of the period beginning at `periodStart`: the same
 * anchor day one calendar month later, clamped to that month's length. */
export function periodEndFor(periodStart: Date, anchorDay: number): Date {
  const endMonthKey = shiftMonthKey(toMonthKey(periodStart), 1);
  const [year, month] = endMonthKey.split("-").map(Number) as [number, number];
  return clampBillingDay(year, month, anchorDay);
}

/** The full period starting at `periodStart`. */
export function buildPeriod(periodStart: Date, anchorDay: number): BillingPeriod {
  return { periodStart, periodEnd: periodEndFor(periodStart, anchorDay) };
}

/** The period immediately following `period` — starts exactly where the
 * previous one ended, so no day is ever billed twice or skipped. */
export function nextPeriodAfter(period: BillingPeriod, anchorDay: number): BillingPeriod {
  return buildPeriod(period.periodEnd, anchorDay);
}

/**
 * The reporting month a due belongs to in the month-scoped Ledger views
 * (Ledger Overview's "Billed", the Dashboard's month/range cards).
 *
 * Keyed on `dueDate` — the month the money is expected to arrive — NOT on
 * `periodStart`, so a due can be re-dated without silently jumping ledger
 * months. For retainers (collected upfront) the two coincide anyway, since
 * dueDate defaults to periodStart.
 */
export function reportingMonthKey(dueDate: Date): string {
  return toMonthKey(dueDate);
}

/** Human label for a period, e.g. "20 Aug – 19 Sep 2026". `periodEnd` is
 * exclusive, so the last billed day is the day before it — showing the raw
 * exclusive end would make consecutive periods look like they overlap. */
export function formatPeriodLabel(periodStart: Date, periodEnd: Date): string {
  const lastDay = new Date(periodEnd.getTime() - 24 * 60 * 60 * 1000);
  const start = periodStart.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    timeZone: "Asia/Kolkata",
  });
  const end = lastDay.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
  return `${start} – ${end}`;
}
