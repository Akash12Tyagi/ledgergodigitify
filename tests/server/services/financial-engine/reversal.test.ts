import { describe, expect, it } from "vitest";

import { deriveBillingStatus } from "@/server/services/financial-engine";

// Section 14 edge case 7 — reversal drops FULLY_PAID; status re-derives
// from the post-reversal paidPaise, exactly like any other paidPaise
// change (Section 6.2 step 5: "$inc paidPaise −amount; recompute status").
describe("reversal drops a billing's status (Section 14 edge case 7)", () => {
  it("FULLY_PAID -> PARTIALLY_PAID after reversing part of the payment", () => {
    const before = deriveBillingStatus({
      billedPaise: 20000_00,
      carriedInPaise: 0,
      carriedOutPaise: 0,
      paidPaise: 20000_00,
    });
    expect(before.status).toBe("FULLY_PAID");

    // Reverse an ₹8,000 payment (one of the two that summed to 20,000).
    const afterReversal = deriveBillingStatus({
      billedPaise: 20000_00,
      carriedInPaise: 0,
      carriedOutPaise: 0,
      paidPaise: 20000_00 - 8000_00,
    });
    expect(afterReversal.status).toBe("PARTIALLY_PAID");
    expect(afterReversal.remainingPaise).toBe(8000_00);
  });

  it("FULLY_PAID -> PENDING after reversing the only payment", () => {
    const afterReversal = deriveBillingStatus({
      billedPaise: 20000_00,
      carriedInPaise: 0,
      carriedOutPaise: 0,
      paidPaise: 0,
    });
    expect(afterReversal.status).toBe("PENDING");
    expect(afterReversal.remainingPaise).toBe(20000_00);
  });

  it("OVERPAID -> FULLY_PAID after reversing the surplus payment", () => {
    const afterReversal = deriveBillingStatus({
      billedPaise: 20000_00,
      carriedInPaise: 0,
      carriedOutPaise: 0,
      paidPaise: 25000_00 - 5000_00,
    });
    expect(afterReversal.status).toBe("FULLY_PAID");
    expect(afterReversal.remainingPaise).toBe(0);
  });
});
