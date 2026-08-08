import { describe, expect, it } from "vitest";

import {
  anchorDayFrom,
  buildPeriod,
  formatPeriodLabel,
  nextPeriodAfter,
  periodEndFor,
  reportingMonthKey,
} from "@/lib/billing-period";

/** IST midnight on a calendar day, as a UTC instant (IST = UTC+5:30). */
function istMidnight(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - 5.5 * 60 * 60 * 1000);
}

describe("lib/billing-period", () => {
  it("ends a period one calendar month after it starts, on the same day", () => {
    const end = periodEndFor(istMidnight(2026, 8, 20), 20);
    expect(end.getTime()).toBe(istMidnight(2026, 9, 20).getTime());
  });

  it("supports a plain calendar-month cycle", () => {
    const end = periodEndFor(istMidnight(2026, 8, 1), 1);
    expect(end.getTime()).toBe(istMidnight(2026, 9, 1).getTime());
  });

  it("clamps an anchor day the target month is too short for", () => {
    // 31 Jan + 1 month has no 31 Feb; it lands on the last day available.
    const end = periodEndFor(istMidnight(2027, 1, 31), 31);
    expect(end.getTime()).toBe(istMidnight(2027, 2, 28).getTime());
  });

  it("clamps to 29 Feb in a leap year", () => {
    const end = periodEndFor(istMidnight(2028, 1, 31), 31);
    expect(end.getTime()).toBe(istMidnight(2028, 2, 29).getTime());
  });

  it("restores the anchor after a clamped period instead of walking backwards", () => {
    // The classic end-of-month recurrence bug: deriving the next anchor from
    // the clamped 28 Feb would pin the client to the 28th forever. Because
    // the anchor is carried separately, March returns to the 31st.
    const jan = buildPeriod(istMidnight(2027, 1, 31), 31);
    expect(jan.periodEnd.getTime()).toBe(istMidnight(2027, 2, 28).getTime());

    // The February period starts on the clamped date but ends back on the
    // 31st, so the client is never permanently shifted to the 28th.
    const feb = nextPeriodAfter(jan, 31);
    expect(feb.periodStart.getTime()).toBe(istMidnight(2027, 2, 28).getTime());
    expect(feb.periodEnd.getTime()).toBe(istMidnight(2027, 3, 31).getTime());

    const mar = nextPeriodAfter(feb, 31);
    expect(mar.periodStart.getTime()).toBe(istMidnight(2027, 3, 31).getTime());
    expect(mar.periodEnd.getTime()).toBe(istMidnight(2027, 4, 30).getTime());
  });

  it("produces contiguous periods — no shared day, no gap", () => {
    const first = buildPeriod(istMidnight(2026, 8, 20), 20);
    const second = nextPeriodAfter(first, 20);
    expect(second.periodStart.getTime()).toBe(first.periodEnd.getTime());
  });

  it("rolls across a year boundary", () => {
    const dec = buildPeriod(istMidnight(2026, 12, 7), 7);
    expect(dec.periodEnd.getTime()).toBe(istMidnight(2027, 1, 7).getTime());
  });

  it("reads the anchor day in IST, not UTC", () => {
    // 19 Aug 20:00 UTC is already 20 Aug in IST.
    expect(anchorDayFrom(new Date("2026-08-19T20:00:00.000Z"))).toBe(20);
  });

  it("buckets a due into the reporting month of its due date", () => {
    expect(reportingMonthKey(istMidnight(2026, 9, 20))).toBe("2026-09");
  });

  it("labels a period using its last billed day, not the exclusive end", () => {
    // Showing the raw exclusive end would make consecutive periods look like
    // they overlap on the 20th.
    const label = formatPeriodLabel(istMidnight(2026, 8, 20), istMidnight(2026, 9, 20));
    expect(label).toContain("20 Aug");
    expect(label).toContain("19 Sep");
  });
});
