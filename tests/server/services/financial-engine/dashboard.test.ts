import { afterEach, describe, expect, it } from "vitest";

import {
  getDashboardData,
  getDashboardRangeData,
  getEarliestActivityMonthKey,
} from "@/server/services/financial-engine";
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

  it("scopes recentActivity to the requested monthKey — a historical month never shows another month's transactions (Task 2)", async () => {
    const owner = await seedUser({
      name: "OwnerMonth",
      email: `dashmonth-${Date.now()}@example.com`,
      password: "Correct-Horse-Battery-Staple-9",
      role: "owner",
    });
    const account = await seedAccount({ openingBalancePaise: 0, currentBalancePaise: 0 });

    await seedTransaction(owner._id, {
      type: "PAYMENT_IN",
      direction: "IN",
      accountId: account._id,
      amountPaise: 5_000_00,
      monthKey: "2026-06",
      occurredAt: new Date("2026-06-10T06:00:00.000Z"),
    });
    await seedTransaction(owner._id, {
      type: "EXPENSE_OUT",
      direction: "OUT",
      accountId: account._id,
      amountPaise: 1_000_00,
      monthKey: "2026-07",
      occurredAt: new Date("2026-07-10T06:00:00.000Z"),
    });

    const june = await getDashboardData("2026-06");
    expect(june.recentActivity).toHaveLength(1);
    expect(june.recentActivity[0]?.amountPaise).toBe(5_000_00);

    const july = await getDashboardData("2026-07");
    expect(july.recentActivity).toHaveLength(1);
    expect(july.recentActivity[0]?.amountPaise).toBe(1_000_00);
    expect(july.recentActivity[0]?.direction).toBe("OUT");
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

// The Dashboard's From–To range picker: getDashboardRangeData sums flows
// across the whole [from, to] span instead of one calendar month.
describe("getDashboardRangeData", () => {
  afterEach(async () => {
    await clearAllCollections();
  });

  it("matches getDashboardData for a single-month range (from === to)", async () => {
    const owner = await seedUser({
      name: "OwnerSingle",
      email: `dashsingle-${Date.now()}@example.com`,
      password: "Correct-Horse-Battery-Staple-9",
      role: "owner",
    });
    const account = await seedAccount({ openingBalancePaise: 0, currentBalancePaise: 0 });
    await seedTransaction(owner._id, {
      type: "PAYMENT_IN",
      direction: "IN",
      accountId: account._id,
      amountPaise: 7_500_00,
      monthKey: "2026-07",
      occurredAt: new Date("2026-07-05T06:00:00.000Z"),
    });

    const single = await getDashboardData("2026-07");
    const range = await getDashboardRangeData("2026-07", "2026-07");

    expect(range.overview.collectedPaise).toBe(single.overview.collectedPaise);
    expect(range.recentActivity).toHaveLength(single.recentActivity.length);
    expect(range.monthKey).toBe("2026-07");
  });

  it("sums flows and recentActivity across every month in the range", async () => {
    const owner = await seedUser({
      name: "OwnerRange",
      email: `dashrange-${Date.now()}@example.com`,
      password: "Correct-Horse-Battery-Staple-9",
      role: "owner",
    });
    const account = await seedAccount({ openingBalancePaise: 0, currentBalancePaise: 0 });

    await seedTransaction(owner._id, {
      type: "PAYMENT_IN",
      direction: "IN",
      accountId: account._id,
      amountPaise: 5_000_00,
      monthKey: "2026-05",
      occurredAt: new Date("2026-05-10T06:00:00.000Z"),
    });
    await seedTransaction(owner._id, {
      type: "PAYMENT_IN",
      direction: "IN",
      accountId: account._id,
      amountPaise: 3_000_00,
      monthKey: "2026-06",
      occurredAt: new Date("2026-06-10T06:00:00.000Z"),
    });
    await seedTransaction(owner._id, {
      type: "EXPENSE_OUT",
      direction: "OUT",
      accountId: account._id,
      amountPaise: 1_000_00,
      monthKey: "2026-07",
      occurredAt: new Date("2026-07-10T06:00:00.000Z"),
    });

    const range = await getDashboardRangeData("2026-05", "2026-07");

    expect(range.overview.collectedPaise).toBe(8_000_00);
    expect(range.overview.expensesPaise).toBe(1_000_00);
    expect(range.monthKey).toBe("2026-07");
    expect(range.recentActivity).toHaveLength(3);

    // A month outside the range must not leak in.
    const narrower = await getDashboardRangeData("2026-06", "2026-07");
    expect(narrower.overview.collectedPaise).toBe(3_000_00);
    expect(narrower.recentActivity).toHaveLength(2);
  });
});

// Task 2 — the Dashboard month picker's lower bound: go-live date, falling
// back to the company's first financial record when unset.
describe("getEarliestActivityMonthKey", () => {
  afterEach(async () => {
    await clearAllCollections();
  });

  it("returns null when there is no activity yet", async () => {
    expect(await getEarliestActivityMonthKey()).toBeNull();
  });

  it("returns the monthKey of the oldest active transaction, ignoring reversed ones", async () => {
    const owner = await seedUser({
      name: "OwnerEarliest",
      email: `earliest-${Date.now()}@example.com`,
      password: "Correct-Horse-Battery-Staple-9",
      role: "owner",
    });
    const account = await seedAccount({ openingBalancePaise: 0, currentBalancePaise: 0 });

    await seedTransaction(owner._id, {
      accountId: account._id,
      monthKey: "2026-03",
      occurredAt: new Date("2026-03-15T00:00:00.000Z"),
    });
    await seedTransaction(owner._id, {
      accountId: account._id,
      monthKey: "2026-05",
      occurredAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    await seedTransaction(owner._id, {
      accountId: account._id,
      monthKey: "2026-01",
      occurredAt: new Date("2026-01-01T00:00:00.000Z"),
      status: "reversed",
    });

    expect(await getEarliestActivityMonthKey()).toBe("2026-03");
  });
});
