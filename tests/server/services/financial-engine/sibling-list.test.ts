import { afterEach, describe, expect, it } from "vitest";

import { getMonthOverview, listTransactions, sumFilteredTransactions } from "@/server/services/financial-engine";
import { seedAccount, seedTransaction } from "../../../helpers/seed-financial";
import { seedUser, clearAllCollections } from "../../../helpers/seed-user";

const MONTH_KEY = "2026-07";

// Section 4.6 — the sibling-list rule: an aggregate card's value must equal
// the sum of the drill-down list's rows, by construction, because both are
// produced from the same TxFilter. Section 15 explicitly mandates this be
// asserted numerically.
describe("sibling-list rule (Section 4.6)", () => {
  afterEach(async () => {
    await clearAllCollections();
  });

  it("getMonthOverview.collectedPaise equals the sum of listTransactions({monthKey, type:['PAYMENT_IN']}) rows", async () => {
    const owner = await seedUser({
      name: "Owner",
      email: `sib-${Date.now()}@example.com`,
      password: "Correct-Horse-Battery-Staple-9",
      role: "owner",
    });
    const account = await seedAccount({ openingBalancePaise: 0 });

    const amounts = [5_000_00, 12_000_00, 3_500_00];
    for (const amount of amounts) {
      await seedTransaction(owner._id, {
        type: "PAYMENT_IN",
        direction: "IN",
        accountId: account._id,
        amountPaise: amount,
        monthKey: MONTH_KEY,
        occurredAt: new Date("2026-07-10T00:00:00.000Z"),
      });
    }
    // A same-month expense must NOT leak into the payment drill-down.
    await seedTransaction(owner._id, {
      type: "EXPENSE_OUT",
      direction: "OUT",
      accountId: account._id,
      amountPaise: 999_00,
      monthKey: MONTH_KEY,
      occurredAt: new Date("2026-07-11T00:00:00.000Z"),
    });

    const overview = await getMonthOverview(MONTH_KEY);
    const list = await listTransactions({
      monthKey: MONTH_KEY,
      type: ["PAYMENT_IN"],
      pageSize: 100,
    });

    const sumOfRows = list.rows.reduce((sum, row) => sum + row.amountPaise, 0);
    expect(sumOfRows).toBe(overview.collectedPaise);
    expect(sumOfRows).toBe(amounts.reduce((s, a) => s + a, 0));
    expect(list.total).toBe(3);
  });

  it("a reversed transaction is excluded from both the card and the default (active-only) list", async () => {
    const owner = await seedUser({
      name: "Owner2",
      email: `sib2-${Date.now()}@example.com`,
      password: "Correct-Horse-Battery-Staple-9",
      role: "owner",
    });
    const account = await seedAccount({ openingBalancePaise: 0 });

    await seedTransaction(owner._id, {
      type: "PAYMENT_IN",
      direction: "IN",
      accountId: account._id,
      amountPaise: 8_000_00,
      monthKey: MONTH_KEY,
      occurredAt: new Date("2026-07-05T00:00:00.000Z"),
    });
    await seedTransaction(owner._id, {
      type: "PAYMENT_IN",
      direction: "IN",
      accountId: account._id,
      amountPaise: 2_000_00,
      monthKey: MONTH_KEY,
      status: "reversed",
      occurredAt: new Date("2026-07-06T00:00:00.000Z"),
    });
    // A reversed original always has a matching REVERSAL counter-entry in
    // the real app (Section 15/M8: reconcile-fuzz caught that a lone
    // "reversed" row with no counterpart makes getMonthOverview correctly
    // report reconciliationError, since perAccount sums and
    // collected/expenses sums would then genuinely disagree).
    await seedTransaction(owner._id, {
      type: "REVERSAL",
      direction: "OUT",
      accountId: account._id,
      amountPaise: 2_000_00,
      monthKey: MONTH_KEY,
      occurredAt: new Date("2026-07-06T00:00:00.000Z"),
    });

    const overview = await getMonthOverview(MONTH_KEY);
    const list = await listTransactions({ monthKey: MONTH_KEY, type: ["PAYMENT_IN"], pageSize: 100 });
    const sumOfRows = list.rows.reduce((sum, row) => sum + row.amountPaise, 0);

    expect(overview.collectedPaise).toBe(8_000_00);
    expect(sumOfRows).toBe(8_000_00);
    expect(list.total).toBe(1);
  });

  it("sumFilteredTransactions matches the card even when the list is paginated to a single row (Section 14 edge case 33 / DevSumAssertion's basis)", async () => {
    const owner = await seedUser({
      name: "Owner3",
      email: `sib3-${Date.now()}@example.com`,
      password: "Correct-Horse-Battery-Staple-9",
      role: "owner",
    });
    const account = await seedAccount({ openingBalancePaise: 0 });

    const amounts = [1_000_00, 2_000_00, 3_000_00, 4_000_00];
    for (const amount of amounts) {
      await seedTransaction(owner._id, {
        type: "PAYMENT_IN",
        direction: "IN",
        accountId: account._id,
        amountPaise: amount,
        monthKey: MONTH_KEY,
        occurredAt: new Date("2026-07-10T00:00:00.000Z"),
      });
    }

    const overview = await getMonthOverview(MONTH_KEY);
    // A tiny page size — the "current page" sum would badly undercount if
    // DevSumAssertion used it instead of the true filtered total.
    const list = await listTransactions({ monthKey: MONTH_KEY, type: ["PAYMENT_IN"], pageSize: 1 });
    const trueSum = await sumFilteredTransactions({ monthKey: MONTH_KEY, type: ["PAYMENT_IN"] });

    expect(list.rows).toHaveLength(1);
    expect(trueSum).toBe(overview.collectedPaise);
    expect(trueSum).toBe(amounts.reduce((s, a) => s + a, 0));
  });
});
