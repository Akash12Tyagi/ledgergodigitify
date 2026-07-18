import { Types } from "mongoose";
import { afterEach, describe, expect, it } from "vitest";

import { getMonthOverview } from "@/server/services/financial-engine";
import { seedAccount, seedTransaction } from "../../../helpers/seed-financial";
import { seedUser, clearAllCollections } from "../../../helpers/seed-user";

const MONTH_KEY = "2026-07";
// Any instant inside July 2026 IST.
const OCCURRED_AT = new Date("2026-07-10T06:00:00.000Z");

describe("getMonthOverview", () => {
  afterEach(async () => {
    await clearAllCollections();
  });

  it("aggregates collected/credits/expenses and excludes transfers from them, closing == opening + net", async () => {
    const owner = await seedUser({
      name: "Owner",
      email: `mo-${Date.now()}@example.com`,
      password: "Correct-Horse-Battery-Staple-9",
      role: "owner",
    });
    const accountA = await seedAccount({ openingBalancePaise: 1_00_000_00 });
    const accountB = await seedAccount({ openingBalancePaise: 50_000_00 });

    await seedTransaction(owner._id, {
      type: "PAYMENT_IN",
      direction: "IN",
      accountId: accountA._id,
      amountPaise: 20_000_00,
      monthKey: MONTH_KEY,
      occurredAt: OCCURRED_AT,
    });
    await seedTransaction(owner._id, {
      type: "CREDIT_IN",
      direction: "IN",
      accountId: accountA._id,
      amountPaise: 5_000_00,
      monthKey: MONTH_KEY,
      occurredAt: OCCURRED_AT,
    });
    await seedTransaction(owner._id, {
      type: "EXPENSE_OUT",
      direction: "OUT",
      accountId: accountA._id,
      amountPaise: 8_000_00,
      monthKey: MONTH_KEY,
      occurredAt: OCCURRED_AT,
    });

    // A balanced transfer: A -> B, ₹10,000. Must be excluded from
    // collected/credits/expenses but included in each account's in/out.
    const groupId = new Types.ObjectId();
    await seedTransaction(owner._id, {
      type: "TRANSFER",
      direction: "OUT",
      accountId: accountA._id,
      amountPaise: 10_000_00,
      monthKey: MONTH_KEY,
      occurredAt: OCCURRED_AT,
      transactionGroupId: groupId,
    });
    await seedTransaction(owner._id, {
      type: "TRANSFER",
      direction: "IN",
      accountId: accountB._id,
      amountPaise: 10_000_00,
      monthKey: MONTH_KEY,
      occurredAt: OCCURRED_AT,
      transactionGroupId: groupId,
    });

    const overview = await getMonthOverview(MONTH_KEY);

    expect(overview.reconciliationError).toBeFalsy();
    expect(overview.collectedPaise).toBe(20_000_00);
    expect(overview.creditsPaise).toBe(5_000_00);
    expect(overview.expensesPaise).toBe(8_000_00);
    expect(overview.netCashFlowPaise).toBe(20_000_00 + 5_000_00 - 8_000_00);

    expect(overview.openingPositionPaise).toBe(1_00_000_00 + 50_000_00);
    expect(overview.closingPositionPaise).toBe(overview.openingPositionPaise + overview.netCashFlowPaise);

    const accountARow = overview.perAccount.find((r) => r.accountId === accountA._id.toString());
    const accountBRow = overview.perAccount.find((r) => r.accountId === accountB._id.toString());
    // Account A: in = payment + credit = 25,000; out = expense + transfer = 18,000
    expect(accountARow?.inPaise).toBe(25_000_00);
    expect(accountARow?.outPaise).toBe(18_000_00);
    // Account B: in = transfer = 10,000; out = 0
    expect(accountBRow?.inPaise).toBe(10_000_00);
    expect(accountBRow?.outPaise).toBe(0);
  });

  it("flags reconciliationError and hides figures when the ledger doesn't reconcile", async () => {
    const owner = await seedUser({
      name: "Owner2",
      email: `mo2-${Date.now()}@example.com`,
      password: "Correct-Horse-Battery-Staple-9",
      role: "owner",
    });
    const account = await seedAccount({ openingBalancePaise: 0 });

    // A TRANSFER with only one leg — money appears in the closing position
    // without a matching contribution to net cash flow (transfers are
    // excluded from net by design), breaking closing == opening + net.
    await seedTransaction(owner._id, {
      type: "TRANSFER",
      direction: "IN",
      accountId: account._id,
      amountPaise: 5_000_00,
      monthKey: MONTH_KEY,
      occurredAt: OCCURRED_AT,
    });

    const overview = await getMonthOverview(MONTH_KEY);
    expect(overview.reconciliationError).toBe(true);
    // Section 4.3 — never show a possibly-wrong number alongside the error.
    expect(overview.closingPositionPaise).toBe(0);
    expect(overview.collectedPaise).toBe(0);
  });

  it("counts a July-billed payment made in August under July's collected figure (Section 14 edge case 3)", async () => {
    const owner = await seedUser({
      name: "Owner3",
      email: `mo3-${Date.now()}@example.com`,
      password: "Correct-Horse-Battery-Staple-9",
      role: "owner",
    });
    const account = await seedAccount({ openingBalancePaise: 0 });

    // paidAt is in August, but the transaction's monthKey follows the
    // BILLING (July) per Section 5.4/6.1 — the write-side (M3) sets this;
    // here we assert the read-side correctly trusts that stored monthKey.
    await seedTransaction(owner._id, {
      type: "PAYMENT_IN",
      direction: "IN",
      accountId: account._id,
      amountPaise: 12_000_00,
      monthKey: "2026-07",
      occurredAt: new Date("2026-08-02T06:00:00.000Z"),
    });

    const julyOverview = await getMonthOverview("2026-07");
    const augustOverview = await getMonthOverview("2026-08");
    expect(julyOverview.collectedPaise).toBe(12_000_00);
    expect(augustOverview.collectedPaise).toBe(0);
  });
});
