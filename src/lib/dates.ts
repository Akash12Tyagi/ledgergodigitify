import { format } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";

// Section 2.9 — the ONLY date utilities in the codebase. ALL month/due
// logic goes through these; never call `new Date().getMonth()` raw
// (Section 14 edge case 45: server time is UTC, business dates are always
// IST-derived).
const TIME_ZONE = "Asia/Kolkata";

/** Canonical "now" accessor — every other function here calls this instead
 * of `new Date()` directly, so time can be frozen/mocked in tests. */
export function nowIST(): Date {
  return new Date();
}

/** "2026-07" — the IST calendar month containing instant `d`. */
export function toMonthKey(d: Date): string {
  return format(toZonedTime(d, TIME_ZONE), "yyyy-MM");
}

/** "2026-07" shifted by `delta` months (negative goes back) — pure string
 * arithmetic, no Date round-trip needed since "YYYY-MM" is already the
 * canonical month representation everywhere in the app (MonthPicker,
 * financial-engine's sparkline/range helpers). */
export function shiftMonthKey(monthKey: string, delta: number): string {
  const [yearStr, monthStr] = monthKey.split("-");
  let year = Number(yearStr);
  let month = Number(monthStr) + delta; // 1-12, may fall outside range
  while (month < 1) {
    month += 12;
    year -= 1;
  }
  while (month > 12) {
    month -= 12;
    year += 1;
  }
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** "July 2026" for a "YYYY-MM" key, for display only. */
export function formatMonthLabel(monthKey: string): string {
  const [yearStr, monthStr] = monthKey.split("-");
  const date = new Date(Number(yearStr), Number(monthStr) - 1, 1);
  return date.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

/** Section 5.2 — a retainer client's default billingDay is "day-of-month
 * of first nextDueDate" (Section 6.6 step 2), read in IST. */
export function dayOfMonthIST(d: Date): number {
  return toZonedTime(d, TIME_ZONE).getDate();
}

/** "2026-07-10" — today's IST calendar date. */
export function todayIST(): string {
  return format(toZonedTime(nowIST(), TIME_ZONE), "yyyy-MM-dd");
}

/** The UTC instants bounding an IST calendar month: [startUTC, endUTC). */
export function monthKeyToRange(monthKey: string): { startUTC: Date; endUTC: Date } {
  const [yearStr, monthStr] = monthKey.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr); // 1-12

  const startUTC = fromZonedTime(new Date(year, month - 1, 1, 0, 0, 0, 0), TIME_ZONE);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const endUTC = fromZonedTime(new Date(nextYear, nextMonth - 1, 1, 0, 0, 0, 0), TIME_ZONE);

  return { startUTC, endUTC };
}

/** The UTC instants bounding an inclusive span of IST calendar months:
 * [startUTC of `fromMonthKey`, endUTC of `toMonthKey`). Lets date-field
 * collections (expenses' spentAt, credits' receivedAt) be scoped by the
 * same From–To period the monthKey-based aggregates use. */
export function monthRangeToUtc(
  fromMonthKey: string,
  toMonthKey: string
): { startUTC: Date; endUTC: Date } {
  return {
    startUTC: monthKeyToRange(fromMonthKey).startUTC,
    endUTC: monthKeyToRange(toMonthKey).endUTC,
  };
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

const DAYS_IN_MONTH_COMMON = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return 29;
  const days = DAYS_IN_MONTH_COMMON[month - 1];
  if (days === undefined) throw new RangeError(`Invalid month: ${month}`);
  return days;
}

/** 31 -> Feb 28/29 etc. Returns the UTC instant of that IST-midnight day. */
export function clampBillingDay(year: number, month: number, day: number): Date {
  const clampedDay = Math.min(Math.max(day, 1), daysInMonth(year, month));
  return fromZonedTime(new Date(year, month - 1, clampedDay, 0, 0, 0, 0), TIME_ZONE);
}

/** The UTC instant of IST midnight on the calendar day containing `d`. */
export function startOfDayIST(d: Date): Date {
  const zoned = toZonedTime(d, TIME_ZONE);
  return fromZonedTime(
    new Date(zoned.getFullYear(), zoned.getMonth(), zoned.getDate(), 0, 0, 0, 0),
    TIME_ZONE
  );
}

/** IST-midnight based day difference between now and `dueDate`, floored at 0. */
export function daysOverdue(dueDate: Date): number {
  const dueMidnight = startOfDayIST(dueDate);
  const todayMidnight = startOfDayIST(nowIST());
  const diffMs = todayMidnight.getTime() - dueMidnight.getTime();
  const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
  return Math.max(0, diffDays);
}

/**
 * Section 6.1/6.3/6.4 — "≤ today IST; future dates rejected." Compares by
 * IST calendar day, not exact instant, so any time during today is valid
 * (Section 14 edge case 45 — always server-derived, never trusts a client
 * clock).
 */
export function isAfterTodayIST(d: Date): boolean {
  return startOfDayIST(d).getTime() > startOfDayIST(nowIST()).getTime();
}
