import { afterEach, describe, expect, it } from "vitest";

import {
  archiveClient,
  checkClientName,
  createClient,
  pauseClient,
  resumeClient,
  unarchiveClient,
  updateClient,
} from "@/server/services/clients.service";
import { findBillingByClientAndMonth } from "@/server/repositories/monthly-billings.repository";
import { AuditLogModel } from "@/database/models/audit-log.model";
import { seedUser, clearAllCollections } from "../../helpers/seed-user";
import type { AuthedUser } from "@/server/auth/guards";

function actorFrom(user: { _id: unknown; name: string; email: string; role: string }): AuthedUser {
  return { id: String(user._id), name: user.name, email: user.email, role: user.role as AuthedUser["role"] };
}

describe("clients.service", () => {
  afterEach(async () => {
    await clearAllCollections();
  });

  it("createClient inserts the client and its first MonthlyBilling atomically (Section 6.6)", async () => {
    const owner = await seedUser({
      name: "Owner",
      email: `cs-${Date.now()}@example.com`,
      password: "Correct-Horse-Battery-Staple-9",
      role: "owner",
    });
    const actor = actorFrom(owner);

    const { client, billing } = await createClient(
      {
        name: "Acme Pvt Ltd",
        service: "Bookkeeping",
        engagementType: "retainer",
        amountPaise: 20_000_00,
        nextDueDate: new Date("2026-07-15T00:00:00.000Z"),
      },
      actor
    );

    expect(client.name).toBe("Acme Pvt Ltd");
    expect(client.billingDay).toBe(15);
    expect(billing.billedPaise).toBe(20_000_00);
    expect(billing.generatedBy).toBe("client_create");
    expect(billing.status).toBe("PENDING");

    const fetchedBilling = await findBillingByClientAndMonth(client._id.toString(), billing.monthKey);
    expect(fetchedBilling?._id.toString()).toBe(billing._id.toString());

    const audit = await AuditLogModel.findOne({ action: "CLIENT_CREATED", "entity.id": client._id }).lean();
    expect(audit).not.toBeNull();
  });

  it("one_time clients get billedPaise = the full one-time amount, billingDay stays null", async () => {
    const owner = await seedUser({
      name: "Owner2",
      email: `cs2-${Date.now()}@example.com`,
      password: "Correct-Horse-Battery-Staple-9",
      role: "owner",
    });
    const { client, billing } = await createClient(
      {
        name: "One Time Co",
        service: "Audit",
        engagementType: "one_time",
        amountPaise: 50_000_00,
        nextDueDate: new Date("2026-08-01T00:00:00.000Z"),
      },
      actorFrom(owner)
    );
    expect(client.billingDay).toBeNull();
    expect(billing.billedPaise).toBe(50_000_00);
  });

  it("checkClientName warns on a case-insensitive duplicate among non-archived clients but never blocks (Section 14 edge case 25)", async () => {
    const owner = await seedUser({
      name: "Owner3",
      email: `cs3-${Date.now()}@example.com`,
      password: "Correct-Horse-Battery-Staple-9",
      role: "owner",
    });
    await createClient(
      {
        name: "Acme Pvt Ltd",
        service: "Bookkeeping",
        engagementType: "retainer",
        amountPaise: 10_000_00,
        nextDueDate: new Date("2026-07-15T00:00:00.000Z"),
      },
      actorFrom(owner)
    );

    const result = await checkClientName("acme pvt ltd");
    expect(result.duplicate).toBe(true);

    const noMatch = await checkClientName("Totally Different Co");
    expect(noMatch.duplicate).toBe(false);

    // Still allowed to create — createClient itself never blocks on this.
    const second = await createClient(
      {
        name: "Acme Pvt Ltd",
        service: "Bookkeeping",
        engagementType: "retainer",
        amountPaise: 10_000_00,
        nextDueDate: new Date("2026-07-15T00:00:00.000Z"),
      },
      actorFrom(owner)
    );
    expect(second.client.name).toBe("Acme Pvt Ltd");
  });

  it("updateClient uses optimistic locking — a stale version is a CONFLICT (Section 6.7)", async () => {
    const owner = await seedUser({
      name: "Owner4",
      email: `cs4-${Date.now()}@example.com`,
      password: "Correct-Horse-Battery-Staple-9",
      role: "owner",
    });
    const actor = actorFrom(owner);
    const { client } = await createClient(
      {
        name: "Version Co",
        service: "Bookkeeping",
        engagementType: "retainer",
        amountPaise: 15_000_00,
        nextDueDate: new Date("2026-07-15T00:00:00.000Z"),
      },
      actor
    );
    expect(client.version).toBe(0);

    const updated = await updateClient(client._id.toString(), { version: 0, notes: "first edit" }, actor);
    expect(updated.version).toBe(1);
    expect(updated.notes).toBe("first edit");

    // Stale version (0 again) must be rejected now that it's 1.
    await expect(
      updateClient(client._id.toString(), { version: 0, notes: "stale edit" }, actor)
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("archiving and unarchiving round-trip status and are audit-logged (Section 14 edge case 28)", async () => {
    const owner = await seedUser({
      name: "Owner5",
      email: `cs5-${Date.now()}@example.com`,
      password: "Correct-Horse-Battery-Staple-9",
      role: "owner",
    });
    const actor = actorFrom(owner);
    const { client } = await createClient(
      {
        name: "Archive Co",
        service: "Bookkeeping",
        engagementType: "retainer",
        amountPaise: 15_000_00,
        nextDueDate: new Date("2026-07-15T00:00:00.000Z"),
      },
      actor
    );

    const paused = await pauseClient(client._id.toString(), actor);
    expect(paused.status).toBe("paused");
    const resumed = await resumeClient(client._id.toString(), actor);
    expect(resumed.status).toBe("active");

    const archived = await archiveClient(client._id.toString(), "No longer engaged", actor);
    expect(archived.status).toBe("archived");
    expect(archived.archiveReason).toBe("No longer engaged");

    const unarchived = await unarchiveClient(client._id.toString(), actor);
    expect(unarchived.status).toBe("active");
    expect(unarchived.archivedAt).toBeNull();

    const actions = await AuditLogModel.find({ "entity.id": client._id }).sort({ createdAt: 1 }).lean();
    expect(actions.map((a) => a.action)).toEqual([
      "CLIENT_CREATED",
      "CLIENT_PAUSED",
      "CLIENT_RESUMED",
      "CLIENT_ARCHIVED",
      "CLIENT_UNARCHIVED",
    ]);
  });
});
