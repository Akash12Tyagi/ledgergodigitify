import { describe, expect, it } from "vitest";

import { computeOverpaymentSurplus, deriveBillingStatus } from "@/server/services/financial-engine";

// Section 4.4 — the status truth table, every row (values in the spec are
// given in ₹ "for readability"; tested here in paise as the engine
// actually stores them).
describe("deriveBillingStatus — Section 4.4 truth table", () => {
  it.each([
    { billed: 20000_00, carriedIn: 0, paid: 0, expectedStatus: "PENDING", expectedRemaining: 20000_00 },
    { billed: 20000_00, carriedIn: 0, paid: 8000_00, expectedStatus: "PARTIALLY_PAID", expectedRemaining: 12000_00 },
    { billed: 20000_00, carriedIn: 0, paid: 20000_00, expectedStatus: "FULLY_PAID", expectedRemaining: 0 },
    { billed: 20000_00, carriedIn: 0, paid: 25000_00, expectedStatus: "OVERPAID", expectedRemaining: 0 },
    { billed: 20000_00, carriedIn: 7000_00, paid: 20000_00, expectedStatus: "PARTIALLY_PAID", expectedRemaining: 7000_00 },
    { billed: 20000_00, carriedIn: 7000_00, paid: 27000_00, expectedStatus: "FULLY_PAID", expectedRemaining: 0 },
    { billed: 0, carriedIn: 7000_00, paid: 7000_00, expectedStatus: "FULLY_PAID", expectedRemaining: 0 },
  ])(
    "billed=$billed carriedIn=$carriedIn paid=$paid -> $expectedStatus, remaining=$expectedRemaining",
    ({ billed, carriedIn, paid, expectedStatus, expectedRemaining }) => {
      const { status, remainingPaise } = deriveBillingStatus({
        billedPaise: billed,
        carriedInPaise: carriedIn,
        carriedOutPaise: 0,
        paidPaise: paid,
      });
      expect(status).toBe(expectedStatus);
      expect(remainingPaise).toBe(expectedRemaining);
    }
  );

  it("paise-exact comparisons — one paisa short is still PARTIALLY_PAID, never FULLY_PAID", () => {
    const { status, remainingPaise } = deriveBillingStatus({
      billedPaise: 20000_00,
      carriedInPaise: 0,
      carriedOutPaise: 0,
      paidPaise: 20000_00 - 1,
    });
    expect(status).toBe("PARTIALLY_PAID");
    expect(remainingPaise).toBe(1);
  });

  it("carriedOutPaise (Section 6.8A) reduces the settlement target", () => {
    // A billing that carried its whole remainder OUT to next month's bill
    // (target = billed - carriedOut = 0) is immediately settled.
    const { status, remainingPaise } = deriveBillingStatus({
      billedPaise: 20000_00,
      carriedInPaise: 0,
      carriedOutPaise: 20000_00,
      paidPaise: 0,
    });
    expect(status).toBe("PENDING"); // paid === 0 is checked first, per spec's literal ordering
    expect(remainingPaise).toBe(0);
  });

  it("zero-target zero-paid billing is PENDING (spec's literal if/elif ordering: paid==0 checked first)", () => {
    const { status, remainingPaise } = deriveBillingStatus({
      billedPaise: 0,
      carriedInPaise: 0,
      carriedOutPaise: 0,
      paidPaise: 0,
    });
    expect(status).toBe("PENDING");
    expect(remainingPaise).toBe(0);
  });
});

describe("computeOverpaymentSurplus — Section 14 edge case 2", () => {
  it("is 0 for every non-OVERPAID status", () => {
    expect(computeOverpaymentSurplus({ billedPaise: 20000_00, carriedInPaise: 0, carriedOutPaise: 0, paidPaise: 0 })).toBe(0);
    expect(computeOverpaymentSurplus({ billedPaise: 20000_00, carriedInPaise: 0, carriedOutPaise: 0, paidPaise: 20000_00 })).toBe(0);
  });

  it("equals paid - target when overpaid", () => {
    expect(
      computeOverpaymentSurplus({ billedPaise: 20000_00, carriedInPaise: 0, carriedOutPaise: 0, paidPaise: 25000_00 })
    ).toBe(5000_00);
  });
});
