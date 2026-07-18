import { afterEach, describe, expect, it } from "vitest";

import { getDuesList } from "@/server/services/financial-engine";
import { seedBilling, seedClient } from "../../../helpers/seed-financial";
import { seedUser, clearAllCollections } from "../../../helpers/seed-user";

const AS_OF = "2026-07-15";

describe("getDuesList (Section 7.10)", () => {
  afterEach(async () => {
    await clearAllCollections();
  });

  it("buckets clients into overdue / dueSoon / upcoming by earliest due date, using the default dueSoonDays=3", async () => {
    const owner = await seedUser({
      name: "Owner",
      email: `dues-${Date.now()}@example.com`,
      password: "Correct-Horse-Battery-Staple-9",
      role: "owner",
    });

    const overdueClient = await seedClient(owner._id, { name: "Overdue Co" });
    await seedBilling(overdueClient._id, {
      monthKey: "2026-07",
      billedPaise: 10_000_00,
      dueDate: new Date("2026-07-09T18:30:00.000Z"), // 10 Jul IST, 5 days before AS_OF
      status: "PENDING",
    });

    const dueSoonClient = await seedClient(owner._id, { name: "Due Soon Co" });
    await seedBilling(dueSoonClient._id, {
      monthKey: "2026-07",
      billedPaise: 10_000_00,
      dueDate: new Date("2026-07-16T18:30:00.000Z"), // 17 Jul IST, 2 days after AS_OF
      status: "PENDING",
    });

    const upcomingClient = await seedClient(owner._id, { name: "Upcoming Co" });
    await seedBilling(upcomingClient._id, {
      monthKey: "2026-07",
      billedPaise: 10_000_00,
      dueDate: new Date("2026-07-30T18:30:00.000Z"), // 31 Jul IST, well beyond dueSoonDays
      status: "PENDING",
    });

    const dues = await getDuesList(AS_OF);

    expect(dues.overdue.map((r) => r.clientName)).toEqual(["Overdue Co"]);
    expect(dues.dueSoon.map((r) => r.clientName)).toEqual(["Due Soon Co"]);
    expect(dues.upcoming.map((r) => r.clientName)).toEqual(["Upcoming Co"]);
    expect(dues.overdueTotalPaise).toBe(10_000_00);
  });

  it("combines multiple outstanding months for the same client into one row (Section 7.10 'Months owed')", async () => {
    const owner = await seedUser({
      name: "Owner2",
      email: `dues2-${Date.now()}@example.com`,
      password: "Correct-Horse-Battery-Staple-9",
      role: "owner",
    });
    const client = await seedClient(owner._id, { name: "Multi Month Co" });

    await seedBilling(client._id, {
      monthKey: "2026-06",
      billedPaise: 10_000_00,
      dueDate: new Date("2026-06-14T18:30:00.000Z"),
      status: "PENDING",
    });
    await seedBilling(client._id, {
      monthKey: "2026-07",
      billedPaise: 10_000_00,
      dueDate: new Date("2026-07-14T18:30:00.000Z"),
      status: "PENDING",
    });

    const dues = await getDuesList(AS_OF);
    const row = dues.overdue.find((r) => r.clientName === "Multi Month Co");
    expect(row).toBeDefined();
    expect(row?.monthsOwed.sort()).toEqual(["2026-06", "2026-07"]);
    expect(row?.remainingPaise).toBe(20_000_00);
  });

  it("excludes FULLY_PAID and OVERPAID billings entirely", async () => {
    const owner = await seedUser({
      name: "Owner3",
      email: `dues3-${Date.now()}@example.com`,
      password: "Correct-Horse-Battery-Staple-9",
      role: "owner",
    });
    const client = await seedClient(owner._id, { name: "Paid Up Co" });
    await seedBilling(client._id, {
      monthKey: "2026-07",
      billedPaise: 10_000_00,
      paidPaise: 10_000_00,
      dueDate: new Date("2026-07-09T18:30:00.000Z"),
      status: "FULLY_PAID",
    });

    const dues = await getDuesList(AS_OF);
    expect(dues.overdue).toHaveLength(0);
    expect(dues.dueSoon).toHaveLength(0);
    expect(dues.upcoming).toHaveLength(0);
  });

  it("routes archived clients' dues to the archivedWithDues section regardless of urgency (Section 14 edge case 26)", async () => {
    const owner = await seedUser({
      name: "Owner4",
      email: `dues4-${Date.now()}@example.com`,
      password: "Correct-Horse-Battery-Staple-9",
      role: "owner",
    });
    const archivedClient = await seedClient(owner._id, { name: "Archived Co", status: "archived" });
    await seedBilling(archivedClient._id, {
      monthKey: "2026-07",
      billedPaise: 10_000_00,
      dueDate: new Date("2026-07-09T18:30:00.000Z"), // would be "overdue" if active
      status: "PENDING",
    });

    const dues = await getDuesList(AS_OF);
    expect(dues.overdue).toHaveLength(0);
    expect(dues.archivedWithDues.map((r) => r.clientName)).toEqual(["Archived Co"]);
  });

  it("keeps a paused client's existing dues visible in the normal sections (Section 14 edge case 16)", async () => {
    const owner = await seedUser({
      name: "Owner5",
      email: `dues5-${Date.now()}@example.com`,
      password: "Correct-Horse-Battery-Staple-9",
      role: "owner",
    });
    const pausedClient = await seedClient(owner._id, { name: "Paused Co", status: "paused" });
    await seedBilling(pausedClient._id, {
      monthKey: "2026-07",
      billedPaise: 10_000_00,
      dueDate: new Date("2026-07-09T18:30:00.000Z"),
      status: "PENDING",
    });

    const dues = await getDuesList(AS_OF);
    expect(dues.overdue.map((r) => r.clientName)).toEqual(["Paused Co"]);
    expect(dues.archivedWithDues).toHaveLength(0);
  });
});
