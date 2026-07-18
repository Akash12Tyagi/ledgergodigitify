import { afterEach, describe, expect, it } from "vitest";

import { MonthlyBillingModel } from "@/database/models/monthly-billing.model";
import { getClientTotalDue } from "@/server/services/financial-engine";
import { seedBilling, seedClient } from "../../../helpers/seed-financial";
import { seedUser, clearAllCollections } from "../../../helpers/seed-user";

// Section 6.8A — the carry is implemented as a MOVE (carriedOutPaise on the
// source billing, carriedInPaise on the destination), specifically so that
// "total due before carry == total due after carry, always" (Section
// 15's mandated invariant test). The actual rollover cron is M6; this
// tests the invariant the formulas must uphold once it exists.
describe("carry-move invariant (Section 6.8A)", () => {
  afterEach(async () => {
    await clearAllCollections();
  });

  it("moving June's ₹7,000 remainder into July leaves total due unchanged", async () => {
    const owner = await seedUser({
      name: "Owner",
      email: `owner-${Date.now()}@example.com`,
      password: "Correct-Horse-Battery-Staple-9",
      role: "owner",
    });
    const client = await seedClient(owner._id, { amountPaise: 20_000_00 });

    // June: partially paid, ₹7,000 remaining, carry not yet applied.
    await seedBilling(client._id, {
      monthKey: "2026-06",
      billedPaise: 20_000_00,
      paidPaise: 13_000_00,
      status: "PARTIALLY_PAID",
      dueDate: new Date("2026-06-14T18:30:00.000Z"),
    });
    // July's own bill already exists independently of the carry — the
    // invariant is about redistributing June's ₹7,000 between the two
    // rows, NOT about whether creating a new month's bill changes the
    // total (it obviously does; that's a separate ₹20,000 of new debt).
    await seedBilling(client._id, {
      monthKey: "2026-07",
      billedPaise: 20_000_00,
      carriedInPaise: 0,
      paidPaise: 0,
      status: "PENDING",
      dueDate: new Date("2026-07-14T18:30:00.000Z"),
    });

    // BEFORE the carry: June owes 7,000 on its own row, July owes 20,000
    // on its own row.
    const totalDueBefore = await getClientTotalDue(client._id.toString());
    expect(totalDueBefore).toBe(27_000_00);

    // Apply the carry: June's remainder MOVES to July via
    // carriedOutPaise/carriedInPaise — no `remaining` is created or lost.
    const juneBilling = await MonthlyBillingModel.findOneAndUpdate(
      { clientId: client._id, monthKey: "2026-06" },
      { $set: { carriedOutPaise: 7_000_00 } },
      { returnDocument: "after" }
    );
    expect(juneBilling).not.toBeNull();
    await MonthlyBillingModel.findOneAndUpdate(
      { clientId: client._id, monthKey: "2026-07" },
      { $set: { carriedInPaise: 7_000_00 } }
    );

    // AFTER the carry: June's row is now settled (0), July's row now
    // carries the full 27,000 — but the GRAND TOTAL is unchanged.
    const totalDueAfter = await getClientTotalDue(client._id.toString());
    expect(totalDueAfter).toBe(totalDueBefore);
    expect(totalDueAfter).toBe(27_000_00);

    const history = await MonthlyBillingModel.find({ clientId: client._id }).lean();
    const june = history.find((b) => b.monthKey === "2026-06");
    const july = history.find((b) => b.monthKey === "2026-07");
    expect(june?.carriedOutPaise).toBe(7_000_00);
    expect(july?.carriedInPaise).toBe(7_000_00);
  });

  it("the invariant holds even when the carried amount is fully absorbed by an overpayment", async () => {
    const owner = await seedUser({
      name: "Owner2",
      email: `owner2-${Date.now()}@example.com`,
      password: "Correct-Horse-Battery-Staple-9",
      role: "owner",
    });
    const client = await seedClient(owner._id, { amountPaise: 20_000_00 });

    await seedBilling(client._id, {
      monthKey: "2026-06",
      billedPaise: 20_000_00,
      paidPaise: 13_000_00,
      carriedOutPaise: 7_000_00,
      status: "PENDING",
      dueDate: new Date("2026-06-14T18:30:00.000Z"),
    });
    await seedBilling(client._id, {
      monthKey: "2026-07",
      billedPaise: 20_000_00,
      carriedInPaise: 7_000_00,
      paidPaise: 27_000_00, // client pays it all off in one go
      status: "FULLY_PAID",
      dueDate: new Date("2026-07-14T18:30:00.000Z"),
    });

    const totalDue = await getClientTotalDue(client._id.toString());
    expect(totalDue).toBe(0);
  });
});
