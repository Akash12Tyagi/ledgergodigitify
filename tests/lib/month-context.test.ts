import { describe, expect, it } from "vitest";

import { isValidMonthKey, resolveMonthKey } from "@/lib/month-context";

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

describe("resolveMonthKey", () => {
  it("uses the cookie value when it's a well-formed monthKey", () => {
    expect(resolveMonthKey("2026-03", "2026-07")).toBe("2026-03");
  });

  it("falls back when the cookie is missing or malformed (never trusts a bad cookie)", () => {
    expect(resolveMonthKey(undefined, "2026-07")).toBe("2026-07");
    expect(resolveMonthKey("garbage", "2026-07")).toBe("2026-07");
  });
});
