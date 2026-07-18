import { afterEach, describe, expect, it } from "vitest";

import { getAccountActivity } from "@/server/services/financial-engine";
import { seedAccount, seedTransaction } from "../../../helpers/seed-financial";
import { seedUser, clearAllCollections } from "../../../helpers/seed-user";

// Section 7.8 — activity table with a server-computed running balance.
describe("getAccountActivity", () => {
  afterEach(async () => {
    await clearAllCollections();
  });

  it("computes a correct running balance across transactions, newest first", async () => {
    const owner = await seedUser({
      name: "Owner",
      email: `act-${Date.now()}@example.com`,
      password: "Correct-Horse-Battery-Staple-9",
      role: "owner",
    });
    const account = await seedAccount({ openingBalancePaise: 1000_00 });

    // opening 1000 -> +500 (1500) -> -200 (1300) -> +1000 (2300)
    await seedTransaction(owner._id, {
      accountId: account._id,
      direction: "IN",
      amountPaise: 500_00,
      occurredAt: new Date("2026-07-01T00:00:00.000Z"),
    });
    await seedTransaction(owner._id, {
      type: "EXPENSE_OUT",
      direction: "OUT",
      accountId: account._id,
      amountPaise: 200_00,
      occurredAt: new Date("2026-07-02T00:00:00.000Z"),
    });
    await seedTransaction(owner._id, {
      accountId: account._id,
      direction: "IN",
      amountPaise: 1000_00,
      occurredAt: new Date("2026-07-03T00:00:00.000Z"),
    });

    const page = await getAccountActivity(account._id.toString(), { page: 1, pageSize: 20 });

    expect(page.total).toBe(3);
    // newest first
    expect(page.rows[0]?.amountPaise).toBe(1000_00);
    expect(page.rows[0]?.runningBalancePaise).toBe(2300_00);
    expect(page.rows[1]?.amountPaise).toBe(200_00);
    expect(page.rows[1]?.runningBalancePaise).toBe(1300_00);
    expect(page.rows[2]?.amountPaise).toBe(500_00);
    expect(page.rows[2]?.runningBalancePaise).toBe(1500_00);
  });

  it("paginates without breaking the running balance", async () => {
    const owner = await seedUser({
      name: "Owner2",
      email: `act2-${Date.now()}@example.com`,
      password: "Correct-Horse-Battery-Staple-9",
      role: "owner",
    });
    const account = await seedAccount({ openingBalancePaise: 0 });

    for (let i = 1; i <= 5; i++) {
      await seedTransaction(owner._id, {
        accountId: account._id,
        direction: "IN",
        amountPaise: 100_00,
        occurredAt: new Date(`2026-07-0${i}T00:00:00.000Z`),
      });
    }

    const pageOne = await getAccountActivity(account._id.toString(), { page: 1, pageSize: 2 });
    const pageTwo = await getAccountActivity(account._id.toString(), { page: 2, pageSize: 2 });

    expect(pageOne.total).toBe(5);
    expect(pageOne.rows).toHaveLength(2);
    // Newest two: 5th (500) then 4th (400) running balances.
    expect(pageOne.rows[0]?.runningBalancePaise).toBe(500_00);
    expect(pageOne.rows[1]?.runningBalancePaise).toBe(400_00);
    // Page two continues correctly, not restarting from 0.
    expect(pageTwo.rows[0]?.runningBalancePaise).toBe(300_00);
  });
});
