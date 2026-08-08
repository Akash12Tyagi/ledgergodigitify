import { afterEach, describe, expect, it, vi } from "vitest";

import { getClientDuesSummary } from "@/server/services/financial-engine";
import { seedBilling, seedClient } from "../../../helpers/seed-financial";
import { seedUser, clearAllCollections } from "../../../helpers/seed-user";

const PASSWORD = "Correct-Horse-Battery-Staple-9";

function istMidnight(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - 5.5 * 60 * 60 * 1000);
}

async function seedOwner(label: string) {
  return seedUser({
    name: "Owner",
    email: `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    password: PASSWORD,
    role: "owner",
  });
}

afterEach(async () => {
  await clearAllCollections();
  vi.useRealTimers();
});

describe("financial-engine — getClientDuesSummary", () => {
  it("returns a currentDue for a 20th-to-20th client even though no calendar month matches", async () => {
    // This is the regression that hid the Record Payment button entirely:
    // the old lookup asked for "the billing whose monthKey is this calendar
    // month" and got nothing for a client whose cycle straddles months.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-01T05:00:00.000Z"));

    const owner = await seedOwner("cd1");
    const client = await seedClient(owner._id, { amountPaise: 10_000_00 });
    await seedBilling(client._id, {
      monthKey: "2026-08",
      periodStart: istMidnight(2026, 8, 20),
      periodEnd: istMidnight(2026, 9, 20),
      dueDate: istMidnight(2026, 8, 20),
      billedPaise: 10_000_00,
    });

    const summary = await getClientDuesSummary(client._id.toString());

    expect(summary.currentDue).not.toBeNull();
    expect(summary.currentDue?.remainingPaise).toBe(10_000_00);
    expect(summary.currentDue?.periodLabel).toContain("20 Aug");
    expect(summary.totalDuePaise).toBe(10_000_00);
  });

  it("keeps every unpaid period open separately and totals them", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-10T05:00:00.000Z"));

    const owner = await seedOwner("cd2");
    const client = await seedClient(owner._id, { amountPaise: 10_000_00 });

    await seedBilling(client._id, {
      monthKey: "2026-08",
      periodStart: istMidnight(2026, 8, 1),
      periodEnd: istMidnight(2026, 9, 1),
      dueDate: istMidnight(2026, 8, 1),
      billedPaise: 10_000_00,
      paidPaise: 4_000_00,
      status: "PARTIALLY_PAID",
    });
    await seedBilling(client._id, {
      monthKey: "2026-09",
      periodStart: istMidnight(2026, 9, 1),
      periodEnd: istMidnight(2026, 10, 1),
      dueDate: istMidnight(2026, 9, 1),
      billedPaise: 10_000_00,
    });

    const summary = await getClientDuesSummary(client._id.toString());

    expect(summary.openDues).toHaveLength(2);
    expect(summary.totalDuePaise).toBe(16_000_00); // 6,000 + 10,000
    expect(summary.lifetimePaidPaise).toBe(4_000_00);
    // nextDueDate is the EARLIEST unpaid due — chase the oldest debt first.
    expect(new Date(summary.nextDueDate!).getTime()).toBe(istMidnight(2026, 8, 1).getTime());
  });

  it("derives nextDueDate from open dues and clears overdue once everything is paid", async () => {
    // The clients table used to compute this from the stored
    // Client.nextDueDate, which never advances — so a fully-paid client kept
    // reporting as overdue forever.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-10T05:00:00.000Z"));

    const owner = await seedOwner("cd3");
    const client = await seedClient(owner._id, {
      amountPaise: 10_000_00,
      nextDueDate: istMidnight(2026, 6, 1), // long past, never updated
    });
    await seedBilling(client._id, {
      monthKey: "2026-08",
      periodStart: istMidnight(2026, 8, 1),
      periodEnd: istMidnight(2026, 9, 1),
      dueDate: istMidnight(2026, 8, 1),
      billedPaise: 10_000_00,
      paidPaise: 10_000_00,
      status: "FULLY_PAID",
    });

    const summary = await getClientDuesSummary(client._id.toString());

    expect(summary.openDues).toHaveLength(0);
    expect(summary.totalDuePaise).toBe(0);
    expect(summary.nextDueDate).toBeNull();
    expect(summary.daysOverdue).toBe(0);
    expect(summary.dues[0]?.daysOverdue).toBe(0);
  });

  it("returns an empty summary rather than a phantom PENDING period", async () => {
    // A client with no dues raised must be distinguishable from one with an
    // unpaid due; the old shape returned a synthetic PENDING/₹0 status for
    // both.
    const owner = await seedOwner("cd4");
    const client = await seedClient(owner._id);

    const summary = await getClientDuesSummary(client._id.toString());

    expect(summary.dues).toHaveLength(0);
    expect(summary.currentDue).toBeNull();
    expect(summary.totalDuePaise).toBe(0);
    expect(summary.nextDueDate).toBeNull();
  });

  it("picks the oldest open period as currentDue when none contains today", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-12-15T05:00:00.000Z"));

    const owner = await seedOwner("cd5");
    const client = await seedClient(owner._id, { amountPaise: 10_000_00 });

    await seedBilling(client._id, {
      monthKey: "2026-09",
      periodStart: istMidnight(2026, 9, 1),
      periodEnd: istMidnight(2026, 10, 1),
      dueDate: istMidnight(2026, 9, 1),
    });
    await seedBilling(client._id, {
      monthKey: "2026-10",
      periodStart: istMidnight(2026, 10, 1),
      periodEnd: istMidnight(2026, 11, 1),
      dueDate: istMidnight(2026, 10, 1),
    });

    const summary = await getClientDuesSummary(client._id.toString());

    expect(new Date(summary.currentDue!.periodStart).getTime()).toBe(
      istMidnight(2026, 9, 1).getTime()
    );
  });
});
