import { describe, expect, it } from "vitest";

import { isValidMonthKey } from "@/lib/month-context";
import {
  ALL_TIME_COOKIE_VALUE,
  ALL_TIME_FROM,
  resolvePeriodRange,
} from "@/lib/period-range-context";

describe("isValidMonthKey", () => {
  it("accepts well-formed YYYY-MM keys", () => {
    expect(isValidMonthKey("2026-07")).toBe(true);
    expect(isValidMonthKey("2026-01")).toBe(true);
    expect(isValidMonthKey("2026-12")).toBe(true);
  });

  it("rejects malformed values", () => {
    expect(isValidMonthKey("2026-13")).toBe(false);
    expect(isValidMonthKey("2026-00")).toBe(false);
    expect(isValidMonthKey("2026-7")).toBe(false);
    expect(isValidMonthKey("not-a-month")).toBe(false);
    expect(isValidMonthKey(undefined)).toBe(false);
    expect(isValidMonthKey(null)).toBe(false);
    expect(isValidMonthKey("")).toBe(false);
  });
});

describe("resolvePeriodRange", () => {
  it("uses both cookies when they're well-formed", () => {
    expect(resolvePeriodRange("2026-03", "2026-07", "2026-08")).toEqual({
      from: "2026-03",
      to: "2026-07",
      isAllTime: false,
    });
  });

  it("defaults to all time when nothing has been chosen yet", () => {
    // The whole record is a ledger's most useful opening question, and the
    // old current-month default made a freshly-loaded app look empty on the
    // 1st of a month. `from` is the query floor, never a real month.
    expect(resolvePeriodRange(undefined, undefined, "2026-07")).toEqual({
      from: ALL_TIME_FROM,
      to: "2026-07",
      isAllTime: true,
    });
  });

  it("honours an explicitly chosen all-time period", () => {
    expect(resolvePeriodRange(ALL_TIME_COOKIE_VALUE, ALL_TIME_COOKIE_VALUE, "2026-07")).toEqual({
      from: ALL_TIME_FROM,
      to: "2026-07",
      isAllTime: true,
    });
  });

  it("falls back to a single-month range when a stored cookie is malformed", () => {
    // Malformed is different from absent: something WAS chosen, it just
    // can't be read, so this collapses to the fallback month rather than
    // silently widening to every figure on record.
    expect(resolvePeriodRange("garbage", "junk", "2026-07")).toEqual({
      from: "2026-07",
      to: "2026-07",
      isAllTime: false,
    });
  });

  it("defaults `from` to `to` when only `to` is set", () => {
    expect(resolvePeriodRange(undefined, "2026-05", "2026-08")).toEqual({
      from: "2026-05",
      to: "2026-05",
      isAllTime: false,
    });
  });

  it("collapses an inverted range instead of rendering an empty period", () => {
    expect(resolvePeriodRange("2026-09", "2026-04", "2026-08")).toEqual({
      from: "2026-04",
      to: "2026-04",
      isAllTime: false,
    });
  });

  it("sorts the all-time floor before every real month key", () => {
    // Load-bearing: the engine filters on `monthKey: { $gte: from }` with
    // plain string comparison, so all-time only works if this holds.
    expect(ALL_TIME_FROM < "0001-01").toBe(true);
    expect(ALL_TIME_FROM < "2026-08").toBe(true);
  });
});
