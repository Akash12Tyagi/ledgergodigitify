import { afterEach, describe, expect, it, vi } from "vitest";

import { runRollover } from "@/server/services/rollover.service";
import { MonthlyBillingModel } from "@/database/models/monthly-billing.model";
import { AuditLogModel } from "@/database/models/audit-log.model";
import { seedBilling, seedClient } from "../../helpers/seed-financial";
import { seedUser, clearAllCollections } from "../../helpers/seed-user";

const PASSWORD = "Correct-Horse-Battery-Staple-9";

/** IST midnight on a given calendar day, as a UTC instant (IST = UTC+5:30). */
function istMidnight(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - 5.5 * 60 * 60 * 1000);
}

afterEach(async () => {
  await clearAllCollections();
  vi.useRealTimers();
});

describe("rollover.service — runRollover", () => {
  it("does not back-bill a client whose current period is still running", async () => {
    // The original month-keyed rollover asked "is there a billing for this
    // calendar month?" and, finding none for a client whose first period had
    // barely started, billed them again — with a due date already in the
    // past, making a brand-new client instantly overdue. Advancing from the
    // client's own last period makes that structurally impossible.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-08T05:00:00.000Z")); // 8 Aug 2026, IST morning

    const owner = await seedUser({
      name: "Owner",
      email: `roll1-${Date.now()}@example.com`,
      password: PASSWORD,
      role: "owner",
    });
    const client = await seedClient(owner._id, { engagementType: "retainer", amountPaise: 20_000_00 });

    // First period runs 5 Aug – 5 Sep, so nothing new is owed yet.
    await seedBilling(client._id, {
      monthKey: "2026-08",
      periodStart: istMidnight(2026, 8, 5),
      periodEnd: istMidnight(2026, 9, 5),
      dueDate: istMidnight(2026, 8, 5),
      generatedBy: "client_create",
    });

    const result = await runRollover(owner._id.toString(), owner.name);

    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);
    const billings = await MonthlyBillingModel.find({ clientId: client._id }).lean();
    expect(billings).toHaveLength(1);
  });

  it("raises the next period once the current one ends, and repeat runs are a no-op", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-06T05:00:00.000Z")); // one day into the next period

    const owner = await seedUser({
      name: "Owner2",
      email: `roll2-${Date.now()}@example.com`,
      password: PASSWORD,
      role: "owner",
    });
    const client = await seedClient(owner._id, { engagementType: "retainer", amountPaise: 20_000_00 });
    await seedBilling(client._id, {
      monthKey: "2026-08",
      periodStart: istMidnight(2026, 8, 5),
      periodEnd: istMidnight(2026, 9, 5),
      dueDate: istMidnight(2026, 8, 5),
      generatedBy: "client_create",
    });

    for (let i = 0; i < 5; i++) {
      await runRollover(owner._id.toString(), owner.name);
    }

    const billings = await MonthlyBillingModel.find({ clientId: client._id })
      .sort({ periodStart: 1 })
      .lean();
    expect(billings).toHaveLength(2);

    const next = billings[1];
    expect(next?.periodStart.getTime()).toBe(istMidnight(2026, 9, 5).getTime());
    expect(next?.periodEnd.getTime()).toBe(istMidnight(2026, 10, 5).getTime());
    // Collected up front: the money is owed the day the period begins.
    expect(next?.dueDate.getTime()).toBe(istMidnight(2026, 9, 5).getTime());
    expect(next?.billedPaise).toBe(20_000_00);
    expect(next?.generatedBy).toBe("rollover");
    expect(next?.monthKey).toBe("2026-09");

    const auditCount = await AuditLogModel.countDocuments({ action: "BILLING_GENERATED" });
    expect(auditCount).toBe(1);
  });

  it("leaves an unpaid remainder on its own period instead of carrying it forward", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-06T05:00:00.000Z"));

    const owner = await seedUser({
      name: "Owner3",
      email: `roll3-${Date.now()}@example.com`,
      password: PASSWORD,
      role: "owner",
    });
    const client = await seedClient(owner._id, { engagementType: "retainer", amountPaise: 20_000_00 });
    // 20,000 billed, only 13,000 paid — 7,000 still owed for August.
    await seedBilling(client._id, {
      monthKey: "2026-08",
      periodStart: istMidnight(2026, 8, 5),
      periodEnd: istMidnight(2026, 9, 5),
      dueDate: istMidnight(2026, 8, 5),
      billedPaise: 20_000_00,
      paidPaise: 13_000_00,
      status: "PARTIALLY_PAID",
    });

    await runRollover(owner._id.toString(), owner.name);

    const august = await MonthlyBillingModel.findOne({
      clientId: client._id,
      periodStart: istMidnight(2026, 8, 5),
    }).lean();
    // August keeps its shortfall and stays open — the old behaviour moved
    // the 7,000 into September and stamped August FULLY_PAID, which made a
    // genuinely unpaid period read as settled everywhere it was displayed.
    expect(august?.status).toBe("PARTIALLY_PAID");
    expect(august?.carriedOutPaise).toBe(0);
    expect(august?.paidPaise).toBe(13_000_00);

    const september = await MonthlyBillingModel.findOne({
      clientId: client._id,
      periodStart: istMidnight(2026, 9, 5),
    }).lean();
    // September is billed at the plain rate, with nothing inherited.
    expect(september?.billedPaise).toBe(20_000_00);
    expect(september?.carriedInPaise).toBe(0);
  });

  it("self-heals after missed runs, backfilling every period that has started", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-10T05:00:00.000Z")); // three periods later

    const owner = await seedUser({
      name: "Owner4",
      email: `roll4-${Date.now()}@example.com`,
      password: PASSWORD,
      role: "owner",
    });
    const client = await seedClient(owner._id, { engagementType: "retainer", amountPaise: 10_000_00 });
    await seedBilling(client._id, {
      monthKey: "2026-08",
      periodStart: istMidnight(2026, 8, 5),
      periodEnd: istMidnight(2026, 9, 5),
      dueDate: istMidnight(2026, 8, 5),
    });

    const result = await runRollover(owner._id.toString(), owner.name);

    expect(result.created).toBe(3); // Sep, Oct, Nov
    const billings = await MonthlyBillingModel.find({ clientId: client._id })
      .sort({ periodStart: 1 })
      .lean();
    expect(billings.map((b) => b.periodStart.getTime())).toEqual([
      istMidnight(2026, 8, 5).getTime(),
      istMidnight(2026, 9, 5).getTime(),
      istMidnight(2026, 10, 5).getTime(),
      istMidnight(2026, 11, 5).getTime(),
    ]);
  });

  it("follows a non-calendar cycle — a 20th-to-20th client stays on the 20th", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-21T05:00:00.000Z"));

    const owner = await seedUser({
      name: "Owner5",
      email: `roll5-${Date.now()}@example.com`,
      password: PASSWORD,
      role: "owner",
    });
    const client = await seedClient(owner._id, { engagementType: "retainer", amountPaise: 15_000_00 });
    await client.updateOne({ billingDay: 20 });

    await seedBilling(client._id, {
      monthKey: "2026-08",
      periodStart: istMidnight(2026, 8, 20),
      periodEnd: istMidnight(2026, 9, 20),
      dueDate: istMidnight(2026, 8, 20),
    });

    await runRollover(owner._id.toString(), owner.name);

    const next = await MonthlyBillingModel.findOne({
      clientId: client._id,
      periodStart: istMidnight(2026, 9, 20),
    }).lean();
    expect(next).not.toBeNull();
    expect(next?.periodEnd.getTime()).toBe(istMidnight(2026, 10, 20).getTime());
    // The period straddles two calendar months; it reports into the month
    // the money is due in.
    expect(next?.monthKey).toBe("2026-09");
  });

  it("keeps a month-end anchor pinned to the last day rather than walking backwards", async () => {
    // A 31st anchor clamps to 28 Feb in a common year. Re-deriving the anchor
    // from that clamped date would leave the client billed on the 28th
    // forever; carrying the anchor separately restores 31 Mar.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-03-01T05:00:00.000Z"));

    const owner = await seedUser({
      name: "Owner6",
      email: `roll6-${Date.now()}@example.com`,
      password: PASSWORD,
      role: "owner",
    });
    const client = await seedClient(owner._id, { engagementType: "retainer", amountPaise: 5_000_00 });
    await client.updateOne({ billingDay: 31 });

    await seedBilling(client._id, {
      monthKey: "2027-01",
      periodStart: istMidnight(2027, 1, 31),
      periodEnd: istMidnight(2027, 2, 28),
      dueDate: istMidnight(2027, 1, 31),
    });

    await runRollover(owner._id.toString(), owner.name);

    const next = await MonthlyBillingModel.findOne({
      clientId: client._id,
      periodStart: istMidnight(2027, 2, 28),
    }).lean();
    expect(next).not.toBeNull();
    expect(next?.periodEnd.getTime()).toBe(istMidnight(2027, 3, 31).getTime());
  });

  it("skips a paused client — no due generated", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-06T05:00:00.000Z"));

    const owner = await seedUser({
      name: "Owner7",
      email: `roll7-${Date.now()}@example.com`,
      password: PASSWORD,
      role: "owner",
    });
    const client = await seedClient(owner._id, { engagementType: "retainer", status: "paused" });
    await seedBilling(client._id, {
      monthKey: "2026-08",
      periodStart: istMidnight(2026, 8, 5),
      periodEnd: istMidnight(2026, 9, 5),
    });

    await runRollover(owner._id.toString(), owner.name);

    const billings = await MonthlyBillingModel.find({ clientId: client._id }).lean();
    expect(billings).toHaveLength(1);
  });

  it("skips a one-time client entirely (never re-billed by rollover)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-06T05:00:00.000Z"));

    const owner = await seedUser({
      name: "Owner8",
      email: `roll8-${Date.now()}@example.com`,
      password: PASSWORD,
      role: "owner",
    });
    const client = await seedClient(owner._id, { engagementType: "one_time" });
    await seedBilling(client._id, { monthKey: "2026-06", generatedBy: "client_create" });

    const result = await runRollover(owner._id.toString(), owner.name);

    expect(result.scanned).toBe(0);
    const billings = await MonthlyBillingModel.find({ clientId: client._id }).lean();
    expect(billings).toHaveLength(1); // only the original client_create billing
  });
});
