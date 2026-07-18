import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clampBillingDay,
  daysOverdue,
  formatMonthLabel,
  monthKeyToRange,
  nowIST,
  shiftMonthKey,
  todayIST,
  toMonthKey,
} from "@/lib/dates";

afterEach(() => {
  vi.useRealTimers();
});

describe("toMonthKey — IST/UTC boundary (Section 14 edge case 14)", () => {
  it("23:50 IST on 31 Jan is still 2026-01, even though it's already Feb 1 in UTC", () => {
    // 23:50 IST on 31 Jan 2026 = 18:20 UTC on 31 Jan 2026 — pick an instant
    // that's unambiguous: 23:50 IST = 18:20 UTC same calendar day, so use a
    // later one that crosses midnight UTC too: 2026-01-31T23:50 IST ->
    // 2026-01-31T18:20:00Z.
    const instant = new Date("2026-01-31T18:20:00.000Z");
    expect(toMonthKey(instant)).toBe("2026-01");
  });

  it("just after IST midnight rolls to the next month", () => {
    // 2026-02-01T00:05 IST = 2026-01-31T18:35:00Z
    const instant = new Date("2026-01-31T18:35:00.000Z");
    expect(toMonthKey(instant)).toBe("2026-02");
  });

  it("just before IST midnight stays in the same month", () => {
    // 2026-01-31T23:59 IST = 2026-01-31T18:29:00Z
    const instant = new Date("2026-01-31T18:29:00.000Z");
    expect(toMonthKey(instant)).toBe("2026-01");
  });
});

describe("monthKeyToRange", () => {
  it("bounds an IST calendar month as UTC instants", () => {
    const { startUTC, endUTC } = monthKeyToRange("2026-07");
    // 2026-07-01T00:00 IST = 2026-06-30T18:30:00Z
    expect(startUTC.toISOString()).toBe("2026-06-30T18:30:00.000Z");
    // 2026-08-01T00:00 IST = 2026-07-31T18:30:00Z
    expect(endUTC.toISOString()).toBe("2026-07-31T18:30:00.000Z");
  });

  it("rolls over the year at December", () => {
    const { endUTC } = monthKeyToRange("2026-12");
    expect(endUTC.toISOString()).toBe("2026-12-31T18:30:00.000Z"); // 2027-01-01 IST
  });
});

describe("clampBillingDay", () => {
  it("clamps day 31 to 28 in a non-leap February", () => {
    const d = clampBillingDay(2027, 2, 31);
    expect(toMonthKey(d)).toBe("2027-02");
    // IST midnight of Feb 28, 2027
    expect(d.toISOString()).toBe("2027-02-27T18:30:00.000Z");
  });

  it("clamps day 31 to 29 in leap year 2028", () => {
    const d = clampBillingDay(2028, 2, 31);
    expect(d.toISOString()).toBe("2028-02-28T18:30:00.000Z"); // Feb 29 IST midnight
  });

  it("clamps day 31 to 30 in a 30-day month", () => {
    const d = clampBillingDay(2026, 4, 31);
    expect(d.toISOString()).toBe("2026-04-29T18:30:00.000Z"); // Apr 30 IST midnight
  });

  it("passes through a valid day unchanged", () => {
    const d = clampBillingDay(2026, 7, 15);
    expect(d.toISOString()).toBe("2026-07-14T18:30:00.000Z"); // Jul 15 IST midnight
  });
});

describe("daysOverdue", () => {
  it("is 0 for a due date that is today (IST)", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-15T05:00:00.000Z")); // 10:30 IST
    const dueToday = clampBillingDay(2026, 7, 15);
    expect(daysOverdue(dueToday)).toBe(0);
  });

  it("is 0 for a future due date (never negative)", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-01T05:00:00.000Z"));
    const dueLater = clampBillingDay(2026, 7, 20);
    expect(daysOverdue(dueLater)).toBe(0);
  });

  it("counts whole IST days past a due date", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-20T05:00:00.000Z")); // 10:30 IST, 20 Jul
    const dueFiveDaysAgo = clampBillingDay(2026, 7, 15);
    expect(daysOverdue(dueFiveDaysAgo)).toBe(5);
  });
});

describe("nowIST / todayIST", () => {
  it("todayIST reflects the IST calendar date, not the UTC one", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 00:05 IST on 2026-07-16 = 18:35 UTC on 2026-07-15
    vi.setSystemTime(new Date("2026-07-15T18:35:00.000Z"));
    expect(todayIST()).toBe("2026-07-16");
  });

  it("nowIST returns the current instant", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const frozen = new Date("2026-07-15T10:00:00.000Z");
    vi.setSystemTime(frozen);
    expect(nowIST().getTime()).toBe(frozen.getTime());
  });
});

describe("shiftMonthKey (Section 7.1 MonthPicker / financial-engine sparkline)", () => {
  it("shifts forward and backward within a year", () => {
    expect(shiftMonthKey("2026-07", 1)).toBe("2026-08");
    expect(shiftMonthKey("2026-07", -1)).toBe("2026-06");
  });

  it("rolls over a year boundary in both directions", () => {
    expect(shiftMonthKey("2026-12", 1)).toBe("2027-01");
    expect(shiftMonthKey("2026-01", -1)).toBe("2025-12");
  });

  it("handles a multi-year shift (the 6-month sparkline's worst case)", () => {
    expect(shiftMonthKey("2026-02", -6)).toBe("2025-08");
    expect(shiftMonthKey("2026-02", 13)).toBe("2027-03");
  });

  it("a delta of 0 returns the same monthKey", () => {
    expect(shiftMonthKey("2026-07", 0)).toBe("2026-07");
  });
});

describe("formatMonthLabel", () => {
  it("renders a human-readable month + year", () => {
    expect(formatMonthLabel("2026-07")).toBe("July 2026");
    expect(formatMonthLabel("2026-01")).toBe("January 2026");
  });
});
