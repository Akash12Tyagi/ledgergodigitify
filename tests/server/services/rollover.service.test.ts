import { afterEach, describe, expect, it, vi } from "vitest";

import { runRollover } from "@/server/services/rollover.service";
import { MonthlyBillingModel } from "@/database/models/monthly-billing.model";
import { AuditLogModel } from "@/database/models/audit-log.model";
import { seedBilling, seedClient } from "../../helpers/seed-financial";
import { seedUser, clearAllCollections } from "../../helpers/seed-user";

const PASSWORD = "Correct-Horse-Battery-Staple-9";

afterEach(async () => {
  await clearAllCollections();
  vi.useRealTimers();
});

describe("rollover.service — runRollover (Section 6.8A)", () => {
  it("generates exactly one billing per active retainer client for the current month, and is a no-op on repeat runs", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-10T05:00:00.000Z")); // 10:30 IST, 10 Jul 2026

    const owner = await seedUser({ name: "Owner", email: `roll1-${Date.now()}@example.com`, password: PASSWORD, role: "owner" });
    const client = await seedClient(owner._id, { engagementType: "retainer", amountPaise: 20_000_00 });

    for (let i = 0; i < 5; i++) {
      await runRollover(owner._id.toString(), owner.name);
    }

    const billings = await MonthlyBillingModel.find({ clientId: client._id }).lean();
    expect(billings).toHaveLength(1);
    expect(billings[0]?.monthKey).toBe("2026-07");
    expect(billings[0]?.billedPaise).toBe(20_000_00);
    expect(billings[0]?.generatedBy).toBe("rollover");

    const auditCount = await AuditLogModel.countDocuments({ action: "BILLING_GENERATED" });
    expect(auditCount).toBe(1);
  });

  it("carries an unpaid remainder forward as carriedInPaise, and the source month's status recomputes to FULLY_PAID", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-10T05:00:00.000Z"));

    const owner = await seedUser({ name: "Owner2", email: `roll2-${Date.now()}@example.com`, password: PASSWORD, role: "owner" });
    const client = await seedClient(owner._id, { engagementType: "retainer", amountPaise: 20_000_00 });
    // June billing: 20,000 billed, only 13,000 paid -> 7,000 unpaid remainder.
    await seedBilling(client._id, {
      monthKey: "2026-06",
      billedPaise: 20_000_00,
      paidPaise: 13_000_00,
      status: "PARTIALLY_PAID",
      dueDate: new Date("2026-06-14T18:30:00.000Z"),
    });

    await runRollover(owner._id.toString(), owner.name);

    const july = await MonthlyBillingModel.findOne({ clientId: client._id, monthKey: "2026-07" }).lean();
    expect(july?.carriedInPaise).toBe(7_000_00);
    expect(july?.billedPaise).toBe(20_000_00);

    const june = await MonthlyBillingModel.findOne({ clientId: client._id, monthKey: "2026-06" }).lean();
    expect(june?.carriedOutPaise).toBe(7_000_00);
    expect(june?.status).toBe("FULLY_PAID");

    // Conservation check: the same 7,000 unpaid rupee-amount now shows up
    // as June's carriedOut AND July's carriedIn — never double-counted,
    // never lost.
    expect(june?.carriedOutPaise).toBe(july?.carriedInPaise);
  });

  it("carries an overpaid surplus forward as a NEGATIVE carriedInPaise (a discount on the new bill)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-10T05:00:00.000Z"));

    const owner = await seedUser({ name: "Owner3", email: `roll3-${Date.now()}@example.com`, password: PASSWORD, role: "owner" });
    const client = await seedClient(owner._id, { engagementType: "retainer", amountPaise: 20_000_00 });
    // June billing: 20,000 billed, 25,000 paid -> 5,000 surplus.
    await seedBilling(client._id, {
      monthKey: "2026-06",
      billedPaise: 20_000_00,
      paidPaise: 25_000_00,
      status: "OVERPAID",
      dueDate: new Date("2026-06-14T18:30:00.000Z"),
    });

    await runRollover(owner._id.toString(), owner.name);

    const july = await MonthlyBillingModel.findOne({ clientId: client._id, monthKey: "2026-07" }).lean();
    expect(july?.carriedInPaise).toBe(-5_000_00);

    const june = await MonthlyBillingModel.findOne({ clientId: client._id, monthKey: "2026-06" }).lean();
    expect(june?.carriedOutPaise).toBe(5_000_00);
    expect(june?.status).toBe("FULLY_PAID");
  });

  it("skips a paused client (Section 14 edge case 16) — no billing generated", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-10T05:00:00.000Z"));

    const owner = await seedUser({ name: "Owner4", email: `roll4-${Date.now()}@example.com`, password: PASSWORD, role: "owner" });
    const client = await seedClient(owner._id, { engagementType: "retainer", status: "paused" });

    await runRollover(owner._id.toString(), owner.name);

    const billings = await MonthlyBillingModel.find({ clientId: client._id }).lean();
    expect(billings).toHaveLength(0);
  });

  it("skips a one-time client entirely (never re-billed by rollover)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-10T05:00:00.000Z"));

    const owner = await seedUser({ name: "Owner5", email: `roll5-${Date.now()}@example.com`, password: PASSWORD, role: "owner" });
    const client = await seedClient(owner._id, { engagementType: "one_time" });
    await seedBilling(client._id, { monthKey: "2026-06", generatedBy: "client_create" });

    const result = await runRollover(owner._id.toString(), owner.name);

    expect(result.scanned).toBe(0);
    const billings = await MonthlyBillingModel.find({ clientId: client._id }).lean();
    expect(billings).toHaveLength(1); // only the original client_create billing
  });
});
