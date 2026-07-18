import { afterEach, describe, expect, it, vi } from "vitest";

import { runDueReminders, runMonthSummary } from "@/server/services/notifications.service";
import { NotificationModel } from "@/database/models/notification.model";
import { seedBilling, seedClient } from "../../helpers/seed-financial";
import { seedUser, clearAllCollections } from "../../helpers/seed-user";

const PASSWORD = "Correct-Horse-Battery-Staple-9";

afterEach(async () => {
  await clearAllCollections();
  vi.useRealTimers();
});

describe("notifications.service — runDueReminders (Section 6.8B)", () => {
  it("creates DUE_OVERDUE for an unpaid past-due billing and DUE_UPCOMING for one due soon, deduped on repeat runs", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-15T05:00:00.000Z")); // 10:30 IST, 15 Jul

    const owner = await seedUser({ name: "Owner", email: `dr1-${Date.now()}@example.com`, password: PASSWORD, role: "owner" });
    const overdueClient = await seedClient(owner._id, { name: `Overdue ${Date.now()}` });
    await seedBilling(overdueClient._id, {
      monthKey: "2026-06",
      billedPaise: 10_000_00,
      paidPaise: 0,
      status: "PENDING",
      dueDate: new Date("2026-06-30T18:30:00.000Z"), // already past
    });

    const upcomingClient = await seedClient(owner._id, { name: `Upcoming ${Date.now()}` });
    await seedBilling(upcomingClient._id, {
      monthKey: "2026-07",
      billedPaise: 10_000_00,
      paidPaise: 0,
      status: "PENDING",
      dueDate: new Date("2026-07-16T18:30:00.000Z"), // 1 day from "now" IST
    });

    const first = await runDueReminders();
    expect(first.overdueCreated).toBe(1);
    expect(first.upcomingCreated).toBe(1);

    const overdueDoc = await NotificationModel.findOne({ type: "DUE_OVERDUE" }).lean();
    expect(overdueDoc).not.toBeNull();
    const upcomingDoc = await NotificationModel.findOne({ type: "DUE_UPCOMING" }).lean();
    expect(upcomingDoc).not.toBeNull();

    // A second run must not create duplicates (dedupeKey is per-billing,
    // not per-day).
    const second = await runDueReminders();
    expect(second.overdueCreated).toBe(0);
    expect(second.upcomingCreated).toBe(0);
    expect(await NotificationModel.countDocuments({ type: "DUE_OVERDUE" })).toBe(1);
    expect(await NotificationModel.countDocuments({ type: "DUE_UPCOMING" })).toBe(1);
  });

  it("does not notify for a fully-paid billing or a paused client's unpaid billing", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-15T05:00:00.000Z"));

    const owner = await seedUser({ name: "Owner2", email: `dr2-${Date.now()}@example.com`, password: PASSWORD, role: "owner" });

    const paidClient = await seedClient(owner._id, { name: `Paid ${Date.now()}` });
    await seedBilling(paidClient._id, {
      monthKey: "2026-06",
      billedPaise: 10_000_00,
      paidPaise: 10_000_00,
      status: "FULLY_PAID",
      dueDate: new Date("2026-06-30T18:30:00.000Z"),
    });

    const pausedClient = await seedClient(owner._id, { name: `Paused ${Date.now()}`, status: "paused" });
    await seedBilling(pausedClient._id, {
      monthKey: "2026-06",
      billedPaise: 10_000_00,
      paidPaise: 0,
      status: "PENDING",
      dueDate: new Date("2026-06-30T18:30:00.000Z"),
    });

    const result = await runDueReminders();
    expect(result.overdueCreated).toBe(0);
    expect(result.upcomingCreated).toBe(0);
  });
});

describe("notifications.service — runMonthSummary (Section 6.8C)", () => {
  it("creates one MONTH_SUMMARY notification for the previous month, deduped on repeat runs", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-02T05:00:00.000Z")); // early July -> previous month is June

    const first = await runMonthSummary();
    expect(first.created).toBe(true);

    const doc = await NotificationModel.findOne({ type: "MONTH_SUMMARY" }).lean();
    expect(doc?.dedupeKey).toBe("MONTH_SUMMARY:2026-06");
    expect(doc?.audience).toBe("owner");

    const second = await runMonthSummary();
    expect(second.created).toBe(false);
    expect(await NotificationModel.countDocuments({ type: "MONTH_SUMMARY" })).toBe(1);
  });
});
