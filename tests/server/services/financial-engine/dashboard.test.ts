import { afterEach, describe, expect, it } from "vitest";

import { getDashboardData } from "@/server/services/financial-engine";
import { seedAccount, seedTransaction } from "../../../helpers/seed-financial";
import { seedUser, clearAllCollections } from "../../../helpers/seed-user";

// Section 7.1 — ONE composed call per page.
describe("getDashboardData", () => {
  afterEach(async () => {
    await clearAllCollections();
  });

  it("composes overview, dues, account strip, recent activity, and a 6-month sparkline in one call", async () => {
    const owner = await seedUser({
      name: "Owner",
      email: `dash-${Date.now()}@example.com`,
      password: "Correct-Horse-Battery-Staple-9",
      role: "owner",
    });
    const account = await seedAccount({
      name: "HDFC Current",
      openingBalancePaise: 1_00_000_00,
      currentBalancePaise: 1_20_000_00,
      lowBalanceThresholdPaise: 10_000_00,
    });
    await seedTransaction(owner._id, {
      type: "PAYMENT_IN",
      direction: "IN",
      accountId: account._id,
      amountPaise: 20_000_00,
      monthKey: "2026-07",
      occurredAt: new Date("2026-07-05T06:00:00.000Z"),
    });

    const data = await getDashboardData("2026-07");

    expect(data.monthKey).toBe("2026-07");
    expect(data.overview.collectedPaise).toBe(20_000_00);
    expect(data.accounts).toHaveLength(1);
    expect(data.accounts[0]?.name).toBe("HDFC Current");
    expect(data.accounts[0]?.isLowBalance).toBe(false);
    expect(data.recentActivity.length).toBeGreaterThan(0);
    expect(data.sparkline).toHaveLength(6);
    expect(data.sparkline[5]?.monthKey).toBe("2026-07");
    expect(data.sparkline[5]?.collectedPaise).toBe(20_000_00);
    expect(data.duesThisWeek).toEqual([]);
  });

  it("flags an account as low-balance when currentBalancePaise is under its threshold", async () => {
    await seedAccount({
      name: "Low Cash Box",
      openingBalancePaise: 5_00_00,
      currentBalancePaise: 5_00_00,
      lowBalanceThresholdPaise: 10_000_00,
    });

    const data = await getDashboardData("2026-07");
    expect(data.accounts[0]?.isLowBalance).toBe(true);
  });
});
