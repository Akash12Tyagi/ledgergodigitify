import { afterEach, describe, expect, it } from "vitest";

import {
  getMonthOverview,
  getRangeOverview,
  listTransactions,
  sumFilteredTransactions,
} from "@/server/services/financial-engine";
import { seedAccount, seedTransaction } from "../../../helpers/seed-financial";
import { seedUser, clearAllCollections } from "../../../helpers/seed-user";

const PASSWORD = "Correct-Horse-Battery-Staple-9";

afterEach(async () => {
  await clearAllCollections();
});

async function seedThreeMonths() {
  const owner = await seedUser({
    name: "Owner",
    email: `range-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    password: PASSWORD,
    role: "owner",
  });
  const account = await seedAccount({ openingBalancePaise: 0, currentBalancePaise: 0 });

  // 1,000 collected in each of June, July and August.
  for (const monthKey of ["2026-06", "2026-07", "2026-08"]) {
    await seedTransaction(owner._id, {
      accountId: account._id,
      type: "PAYMENT_IN",
      direction: "IN",
      amountPaise: 1_000_00,
      monthKey,
    });
  }
  // One extra month outside the range under test.
  await seedTransaction(owner._id, {
    accountId: account._id,
    type: "PAYMENT_IN",
    direction: "IN",
    amountPaise: 9_999_00,
    monthKey: "2026-05",
  });

  return { owner, account };
}

describe("financial-engine — From–To period range", () => {
  it("sums flows across the range and excludes months outside it", async () => {
    await seedThreeMonths();

    const range = await getRangeOverview("2026-06", "2026-08");

    expect(range.collectedPaise).toBe(3_000_00);
    expect(range.reconciliationError).toBeUndefined();
  });

  it("a range total equals the sum of its individual months", async () => {
    // The invariant that lets the picker widen without the figures drifting:
    // both paths read the same stored monthKey field.
    await seedThreeMonths();

    const [jun, jul, aug, range] = await Promise.all([
      getMonthOverview("2026-06"),
      getMonthOverview("2026-07"),
      getMonthOverview("2026-08"),
      getRangeOverview("2026-06", "2026-08"),
    ]);

    expect(range.collectedPaise).toBe(jun.collectedPaise + jul.collectedPaise + aug.collectedPaise);
    expect(range.netCashFlowPaise).toBe(
      jun.netCashFlowPaise + jul.netCashFlowPaise + aug.netCashFlowPaise
    );
  });

  it("a single-month range is identical to that month on its own", async () => {
    await seedThreeMonths();

    const [single, range] = await Promise.all([
      getMonthOverview("2026-07"),
      getRangeOverview("2026-07", "2026-07"),
    ]);

    expect(range.collectedPaise).toBe(single.collectedPaise);
    expect(range.openingPositionPaise).toBe(single.openingPositionPaise);
    expect(range.closingPositionPaise).toBe(single.closingPositionPaise);
  });

  it("scopes the transaction list to the range, so card === sum(rows)", async () => {
    // The sibling-list rule: the drill-down list under a card must be
    // filtered by the exact same period the card totals.
    await seedThreeMonths();

    const filter = { monthKeyFrom: "2026-06", monthKeyTo: "2026-08" };
    const [range, list, listedSum] = await Promise.all([
      getRangeOverview("2026-06", "2026-08"),
      listTransactions({ ...filter, type: ["PAYMENT_IN"], pageSize: 100 }),
      sumFilteredTransactions({ ...filter, type: ["PAYMENT_IN"] }),
    ]);

    expect(list.total).toBe(3);
    expect(listedSum).toBe(range.collectedPaise);
    expect(list.rows.every((r) => r.monthKey >= "2026-06" && r.monthKey <= "2026-08")).toBe(true);
  });

  it("prefers the range over a single monthKey when both are supplied", async () => {
    await seedThreeMonths();

    const list = await listTransactions({
      monthKey: "2026-05",
      monthKeyFrom: "2026-06",
      monthKeyTo: "2026-08",
      pageSize: 100,
    });

    expect(list.total).toBe(3);
    expect(list.rows.some((r) => r.monthKey === "2026-05")).toBe(false);
  });
});
