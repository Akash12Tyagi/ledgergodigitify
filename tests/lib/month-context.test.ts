import { describe, expect, it } from "vitest";

import { isValidMonthKey } from "@/lib/month-context";
import { resolvePeriodRange } from "@/lib/period-range-context";

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
    });
  });

  it("falls back to a single-month range when a cookie is missing or malformed", () => {
    expect(resolvePeriodRange(undefined, undefined, "2026-07")).toEqual({
      from: "2026-07",
      to: "2026-07",
    });
    expect(resolvePeriodRange("garbage", "junk", "2026-07")).toEqual({
      from: "2026-07",
      to: "2026-07",
    });
  });

  it("defaults `from` to `to` when only `to` is set", () => {
    expect(resolvePeriodRange(undefined, "2026-05", "2026-08")).toEqual({
      from: "2026-05",
      to: "2026-05",
    });
  });

  it("collapses an inverted range instead of rendering an empty period", () => {
    expect(resolvePeriodRange("2026-09", "2026-04", "2026-08")).toEqual({
      from: "2026-04",
      to: "2026-04",
    });
  });
});
