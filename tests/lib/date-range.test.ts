import { describe, expect, it } from "vitest";

import {
  DATE_PRESETS,
  isValidISODate,
  resolveDateRange,
  toISODateIST,
} from "@/lib/date-range";

const FALLBACK = { from: "2026-08", to: "2026-08" };

describe("date-range — isValidISODate", () => {
  it("accepts a real IST calendar date", () => {
    expect(isValidISODate("2026-08-15")).toBe(true);
  });

  it("rejects malformed and empty input", () => {
    expect(isValidISODate(undefined)).toBe(false);
    expect(isValidISODate("")).toBe(false);
    expect(isValidISODate("15-08-2026")).toBe(false);
    expect(isValidISODate("2026-8-15")).toBe(false);
  });

  it("rejects a day that does not exist in that month", () => {
    // `new Date` silently rolls 31 Feb into March; the round-trip check is
    // what catches it.
    expect(isValidISODate("2026-02-31")).toBe(false);
    expect(isValidISODate("2026-04-31")).toBe(false);
    expect(isValidISODate("2026-13-01")).toBe(false);
  });

  it("handles the leap-year boundary", () => {
    expect(isValidISODate("2028-02-29")).toBe(true);
    expect(isValidISODate("2027-02-29")).toBe(false);
  });
});

describe("date-range — resolveDateRange", () => {
  it("falls back to the month period when no dates are given", () => {
    const result = resolveDateRange(undefined, undefined, FALLBACK);
    expect(result.isExact).toBe(false);
    expect(result.from).toBeNull();
    expect(toISODateIST(result.startUTC)).toBe("2026-08-01");
    // Exclusive end — the instant September begins.
    expect(toISODateIST(result.endUTC)).toBe("2026-09-01");
  });

  it("uses exact dates when both are given", () => {
    const result = resolveDateRange("2026-08-15", "2026-09-03", FALLBACK);
    expect(result.isExact).toBe(true);
    expect(toISODateIST(result.startUTC)).toBe("2026-08-15");
    // 3 Sep is INCLUSIVE, so the exclusive bound is the 4th.
    expect(toISODateIST(result.endUTC)).toBe("2026-09-04");
  });

  it("makes a single-day range cover that whole day", () => {
    const result = resolveDateRange("2026-08-15", "2026-08-15", FALLBACK);
    expect(result.endUTC.getTime() - result.startUTC.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("swaps an inverted pair instead of returning an empty window", () => {
    const result = resolveDateRange("2026-09-03", "2026-08-15", FALLBACK);
    expect(result.from).toBe("2026-08-15");
    expect(result.to).toBe("2026-09-03");
    expect(result.endUTC.getTime()).toBeGreaterThan(result.startUTC.getTime());
  });

  it("fills the missing side from the fallback period when only one bound is given", () => {
    const onlyFrom = resolveDateRange("2026-08-10", undefined, FALLBACK);
    expect(onlyFrom.isExact).toBe(true);
    expect(onlyFrom.from).toBe("2026-08-10");
    expect(onlyFrom.to).toBe("2026-08-31");

    const onlyTo = resolveDateRange(undefined, "2026-08-10", FALLBACK);
    expect(onlyTo.from).toBe("2026-08-01");
    expect(onlyTo.to).toBe("2026-08-10");
  });

  it("ignores a malformed date rather than erroring", () => {
    const result = resolveDateRange("not-a-date", "also-bad", FALLBACK);
    expect(result.isExact).toBe(false);
    expect(toISODateIST(result.startUTC)).toBe("2026-08-01");
  });

  it("spans months correctly when the fallback covers several", () => {
    const result = resolveDateRange(undefined, undefined, { from: "2026-06", to: "2026-08" });
    expect(toISODateIST(result.startUTC)).toBe("2026-06-01");
    expect(toISODateIST(result.endUTC)).toBe("2026-09-01");
  });
});

describe("date-range — presets", () => {
  it("every preset returns a valid, non-inverted range", () => {
    for (const preset of DATE_PRESETS) {
      const { from, to } = preset.range();
      expect(isValidISODate(from), `${preset.id} from`).toBe(true);
      expect(isValidISODate(to), `${preset.id} to`).toBe(true);
      expect(from <= to, `${preset.id} is not inverted`).toBe(true);
    }
  });

  it("'last month' never resolves to the current month", () => {
    const thisMonth = toISODateIST(new Date()).slice(0, 7);
    const lastMonth = DATE_PRESETS.find((p) => p.id === "lastMonth")!.range();
    expect(lastMonth.from.slice(0, 7)).not.toBe(thisMonth);
    // Both bounds land in the same month, and it is the previous one.
    expect(lastMonth.from.slice(0, 7)).toBe(lastMonth.to.slice(0, 7));
  });

  it("'today' is a single day", () => {
    const today = DATE_PRESETS.find((p) => p.id === "today")!.range();
    expect(today.from).toBe(today.to);
  });

  it("'last 7 days' spans exactly 7 inclusive days", () => {
    const { from, to } = DATE_PRESETS.find((p) => p.id === "last7")!.range();
    const range = resolveDateRange(from, to, FALLBACK);
    const days = (range.endUTC.getTime() - range.startUTC.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBe(7);
  });
});
