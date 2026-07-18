import { afterEach, describe, expect, it } from "vitest";

import { getAccountBalance } from "@/server/services/financial-engine";
import { seedAccount, seedTransaction } from "../../../helpers/seed-financial";
import { seedUser, clearAllCollections } from "../../../helpers/seed-user";

// Section 4.3 — accountBalance(asOf) = opening + ΣIN(active,≤asOf) −
// ΣOUT(active,≤asOf).
describe("getAccountBalance", () => {
  afterEach(async () => {
    await clearAllCollections();
  });

  it("equals openingBalancePaise with no transactions", async () => {
    const account = await seedAccount({ openingBalancePaise: 5_00_000_00 });
    expect(await getAccountBalance(account._id.toString())).toBe(5_00_000_00);
  });

  it("adds IN and subtracts OUT", async () => {
    const owner = await seedUser({
      name: "Owner",
      email: `bal-${Date.now()}@example.com`,
      password: "Correct-Horse-Battery-Staple-9",
      role: "owner",
    });
    const account = await seedAccount({ openingBalancePaise: 1_00_000_00 });

    await seedTransaction(owner._id, {
      accountId: account._id,
      direction: "IN",
      amountPaise: 50_000_00,
      occurredAt: new Date("2026-07-05T00:00:00.000Z"),
    });
    await seedTransaction(owner._id, {
      type: "EXPENSE_OUT",
      direction: "OUT",
      accountId: account._id,
      amountPaise: 20_000_00,
      occurredAt: new Date("2026-07-10T00:00:00.000Z"),
    });

    expect(await getAccountBalance(account._id.toString())).toBe(1_00_000_00 + 50_000_00 - 20_000_00);
  });

  it("a reversed transaction plus its matching reversal net to zero (never a lone excluded row — Section 15/M8: reconcile-fuzz caught this)", async () => {
    const owner = await seedUser({
      name: "OwnerRev",
      email: `bal-rev-${Date.now()}@example.com`,
      password: "Correct-Horse-Battery-Staple-9",
      role: "owner",
    });
    const account = await seedAccount({ openingBalancePaise: 1_00_000_00 });

    await seedTransaction(owner._id, {
      accountId: account._id,
      direction: "IN",
      amountPaise: 50_000_00,
      occurredAt: new Date("2026-07-05T00:00:00.000Z"),
    });
    // A reversed original always has a matching REVERSAL counter-entry in
    // the real app (reversePayment/reverseExpense/etc. insert both
    // atomically) — a lone "reversed" row with no counterpart can't occur
    // through real code paths, so this seeds the pair, not just one side.
    await seedTransaction(owner._id, {
      accountId: account._id,
      direction: "IN",
      amountPaise: 999_00,
      status: "reversed",
      occurredAt: new Date("2026-07-12T00:00:00.000Z"),
    });
    await seedTransaction(owner._id, {
      type: "REVERSAL",
      accountId: account._id,
      direction: "OUT",
      amountPaise: 999_00,
      occurredAt: new Date("2026-07-12T00:00:00.000Z"),
    });

    // The pair nets to zero — balance is as if neither had happened.
    expect(await getAccountBalance(account._id.toString())).toBe(1_00_000_00 + 50_000_00);
  });

  it("honors asOf — only counts transactions up to and including that instant", async () => {
    const owner = await seedUser({
      name: "Owner2",
      email: `bal2-${Date.now()}@example.com`,
      password: "Correct-Horse-Battery-Staple-9",
      role: "owner",
    });
    const account = await seedAccount({ openingBalancePaise: 0 });

    await seedTransaction(owner._id, {
      accountId: account._id,
      direction: "IN",
      amountPaise: 10_000_00,
      occurredAt: new Date("2026-07-05T00:00:00.000Z"),
    });
    await seedTransaction(owner._id, {
      accountId: account._id,
      direction: "IN",
      amountPaise: 20_000_00,
      occurredAt: new Date("2026-07-15T00:00:00.000Z"),
    });

    const asOfMidJuly = await getAccountBalance(account._id.toString(), new Date("2026-07-10T00:00:00.000Z"));
    expect(asOfMidJuly).toBe(10_000_00);

    const asOfExactMatch = await getAccountBalance(
      account._id.toString(),
      new Date("2026-07-05T00:00:00.000Z")
    );
    expect(asOfExactMatch).toBe(10_000_00); // occurredAt <= asOf is inclusive
  });

  it("throws NOT_FOUND for a nonexistent account", async () => {
    await expect(getAccountBalance("507f1f77bcf86cd799439011")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
