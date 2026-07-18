import { describe, expect, it } from "vitest";

import { addPaise, formatINR, MoneyParseError, subtractPaise, toPaise } from "@/lib/money";
import { MAX_ENTRY_PAISE } from "@/constants/finance";

describe("toPaise", () => {
  it.each([
    ["12000", 1_200_000],
    ["12,000", 1_200_000],
    ["₹12,000", 1_200_000],
    ["12000.50", 1_200_050],
    ["₹12,000.50", 1_200_050],
    ["0.01", 1],
    ["0", 0],
    [0, 0],
    [12000, 1_200_000],
    ["  ₹1,23,456.78  ", 12_345_678],
  ])("parses %s -> %i paise", (input, expected) => {
    expect(toPaise(input)).toBe(expected);
  });

  it("rejects negatives", () => {
    expect(() => toPaise("-100")).toThrow(MoneyParseError);
    expect(() => toPaise(-100)).toThrow(MoneyParseError);
  });

  it("rejects more than 2 decimal places", () => {
    expect(() => toPaise("100.123")).toThrow(MoneyParseError);
  });

  it("rejects NaN / non-numeric input", () => {
    expect(() => toPaise("not-a-number")).toThrow(MoneyParseError);
    expect(() => toPaise("")).toThrow(MoneyParseError);
    expect(() => toPaise("12.34.56")).toThrow(MoneyParseError);
  });
});

describe("formatINR", () => {
  it("uses en-IN lakh/crore grouping", () => {
    expect(formatINR(1_200_050)).toBe("₹12,000.50");
    expect(formatINR(123_456_789)).toBe("₹12,34,567.89");
  });

  it("renders whole rupees without decimals", () => {
    expect(formatINR(1_200_000)).toBe("₹12,000");
  });

  it("renders zero", () => {
    expect(formatINR(0)).toBe("₹0");
  });

  it("shows a sign when showSign is set", () => {
    expect(formatINR(500, { showSign: true })).toBe("+₹5");
    expect(formatINR(-500, { showSign: true })).toBe("-₹5");
    expect(formatINR(-500)).toBe("-₹5");
  });

  it("round-trips MAX_ENTRY_PAISE without overflow", () => {
    expect(() => formatINR(MAX_ENTRY_PAISE)).not.toThrow();
  });
});

describe("addPaise / subtractPaise", () => {
  it("performs exact integer arithmetic", () => {
    expect(addPaise(100, 50)).toBe(150);
    expect(subtractPaise(100, 50)).toBe(50);
  });

  it("rejects unsafe integers", () => {
    expect(() => addPaise(Number.MAX_SAFE_INTEGER, 1)).toThrow();
  });
});
