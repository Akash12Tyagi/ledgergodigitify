import { afterEach, describe, expect, it } from "vitest";

import { getMonthOverview, getRangeOverview } from "@/server/services/financial-engine";
import { ALL_TIME_FROM } from "@/lib/period-range-context";
import { seedAccount, seedTransaction } from "../../../helpers/seed-financial";
import { seedUser, clearAllCollections } from "../../../helpers/seed-user";

const PASSWORD = "Correct-Horse-Battery-Staple-9";

// Any instant inside the named IST month.
const IN_MARCH = new Date("2026-03-09T06:00:00.000Z");
const IN_JULY = new Date("2026-07-09T06:00:00.000Z");

afterEach(async () => {
  await clearAllCollections();
});

function owner(label: string) {
  return seedUser({
    name: "Owner",
    email: `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    password: PASSWORD,
    role: "owner",
  });
}

describe("opening position — an account's seed balance enters at its creation month", () => {
  it("does not show a seed balance in periods that predate the account", async () => {
    // The bug this replaced: openingBalancePaise was added to every period
    // unconditionally, so an account opened in July appeared at full
    // balance in the opening of March, February, and every month before
    // that — money shown as held during months in which it did not exist.
    await seedAccount({ openingBalancePaise: 19_000_00, createdAt: IN_JULY });

    const march = await getMonthOverview("2026-03");

    expect(march.openingPositionPaise).toBe(0);
    expect(march.closingPositionPaise).toBe(0);
    expect(march.openingBalancesAddedPaise).toBe(0);
    expect(march.reconciliationError).toBeFalsy();
  });

  it("counts it as an inflow in the period the account was opened", async () => {
    await seedAccount({ openingBalancePaise: 19_000_00, createdAt: IN_JULY });

    const july = await getMonthOverview("2026-07");

    expect(july.openingPositionPaise).toBe(0);
    expect(july.openingBalancesAddedPaise).toBe(19_000_00);
    expect(july.netCashFlowPaise).toBe(19_000_00);
    expect(july.closingPositionPaise).toBe(19_000_00);
    expect(july.reconciliationError).toBeFalsy();
  });

  it("counts it as opening once the account predates the period", async () => {
    await seedAccount({ openingBalancePaise: 19_000_00, createdAt: IN_MARCH });

    const july = await getMonthOverview("2026-07");

    expect(july.openingPositionPaise).toBe(19_000_00);
    expect(july.openingBalancesAddedPaise).toBe(0);
    expect(july.netCashFlowPaise).toBe(0);
    expect(july.closingPositionPaise).toBe(19_000_00);
  });

  it("keeps closing == opening + net across a range that straddles the creation month", async () => {
    // The reconciliation assert is the whole reason the seed is surfaced as
    // an explicit flow rather than just dropped from historic openings: a
    // range starting before the account and ending after it would otherwise
    // be short by exactly the seed, and blank the page behind the banner.
    const actor = await owner("straddle");
    const account = await seedAccount({ openingBalancePaise: 19_000_00, createdAt: IN_JULY });
    await seedTransaction(actor._id, {
      accountId: account._id,
      type: "EXPENSE_OUT",
      direction: "OUT",
      amountPaise: 4_000_00,
      monthKey: "2026-07",
      occurredAt: IN_JULY,
    });

    const range = await getRangeOverview("2026-03", "2026-08");

    expect(range.reconciliationError).toBeFalsy();
    expect(range.openingPositionPaise).toBe(0);
    expect(range.openingBalancesAddedPaise).toBe(19_000_00);
    expect(range.expensesPaise).toBe(4_000_00);
    expect(range.closingPositionPaise).toBe(
      range.openingPositionPaise + range.netCashFlowPaise
    );
    expect(range.closingPositionPaise).toBe(15_000_00);
  });

  it("keeps the per-account row's own arithmetic true", async () => {
    const account = await seedAccount({ openingBalancePaise: 19_000_00, createdAt: IN_JULY });

    const july = await getMonthOverview("2026-07");
    const row = july.perAccount.find((r) => r.accountId === account._id.toString());

    expect(row).toBeDefined();
    expect(row!.openingPaise + row!.inPaise - row!.outPaise).toBe(row!.closingPaise);
  });
});

describe("all-time period", () => {
  it("opens at zero and closes at the full position", async () => {
    // Nothing precedes all time, so opening is 0 by definition and every
    // seed balance on record shows up as an inflow instead.
    const actor = await owner("alltime");
    const account = await seedAccount({ openingBalancePaise: 10_000_00, createdAt: IN_MARCH });
    await seedTransaction(actor._id, {
      accountId: account._id,
      type: "PAYMENT_IN",
      direction: "IN",
      amountPaise: 3_000_00,
      monthKey: "2026-07",
      occurredAt: IN_JULY,
    });

    const allTime = await getRangeOverview(ALL_TIME_FROM, "2026-08");

    expect(allTime.reconciliationError).toBeFalsy();
    expect(allTime.openingPositionPaise).toBe(0);
    expect(allTime.openingBalancesAddedPaise).toBe(10_000_00);
    expect(allTime.collectedPaise).toBe(3_000_00);
    expect(allTime.closingPositionPaise).toBe(13_000_00);
  });

  it("includes months no bounded range would reach", async () => {
    const actor = await owner("alltime-old");
    const account = await seedAccount({ openingBalancePaise: 0, createdAt: IN_MARCH });
    await seedTransaction(actor._id, {
      accountId: account._id,
      type: "PAYMENT_IN",
      direction: "IN",
      amountPaise: 777_00,
      monthKey: "2019-01",
      occurredAt: new Date("2019-01-09T06:00:00.000Z"),
    });

    const [allTime, recent] = await Promise.all([
      getRangeOverview(ALL_TIME_FROM, "2026-08"),
      getRangeOverview("2026-06", "2026-08"),
    ]);

    expect(allTime.collectedPaise).toBe(777_00);
    expect(recent.collectedPaise).toBe(0);
  });

  it("equals the sum of its months", async () => {
    // Same invariant the From–To picker relies on: widening the period must
    // not change what the figures mean, only how many months they cover.
    const actor = await owner("alltime-sum");
    const account = await seedAccount({ openingBalancePaise: 0, createdAt: IN_MARCH });
    for (const monthKey of ["2026-06", "2026-07", "2026-08"]) {
      await seedTransaction(actor._id, {
        accountId: account._id,
        type: "PAYMENT_IN",
        direction: "IN",
        amountPaise: 1_000_00,
        monthKey,
      });
    }

    const [allTime, jun, jul, aug] = await Promise.all([
      getRangeOverview(ALL_TIME_FROM, "2026-08"),
      getMonthOverview("2026-06"),
      getMonthOverview("2026-07"),
      getMonthOverview("2026-08"),
    ]);

    expect(allTime.collectedPaise).toBe(
      jun.collectedPaise + jul.collectedPaise + aug.collectedPaise
    );
  });
});
