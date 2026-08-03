import { afterEach, describe, expect, it } from "vitest";

import { listAuditLogs } from "@/server/services/audit.service";
import { updateSettings } from "@/server/services/settings.service";
import { createClient } from "@/server/services/clients.service";
import { seedUser, clearAllCollections } from "../../helpers/seed-user";
import type { AuthedUser } from "@/server/auth/guards";

const PASSWORD = "Correct-Horse-Battery-Staple-9";

function actorFrom(user: { _id: unknown; name: string; email: string; role: string }): AuthedUser {
  return { id: String(user._id), name: user.name, email: user.email, role: user.role as AuthedUser["role"] };
}

afterEach(async () => {
  await clearAllCollections();
});

// Section 15/M8 hardening pass — logAudit's `before`/`after` is a Mongoose
// Mixed field storing whatever a service passed in verbatim (often a raw
// `.lean()` doc with a real ObjectId, e.g. settings.service.ts#updateSettings
// storing `updatedBy`). listAuditLogs feeds these straight into
// AuditDiffDialog, a Client Component — an un-plain ObjectId there trips
// React's "Only plain objects can be passed to Client Components" warning
// (ObjectId has a `toJSON` but isn't one of React's supported built-ins).
describe("audit.service — listAuditLogs sanitizes before/after for Client Component consumption", () => {
  it("returns plain strings, not ObjectId instances, for ID-bearing fields inside after", async () => {
    const owner = await seedUser({
      name: "OwnerAudit",
      email: `audit-sanitize-${Date.now()}@example.com`,
      password: PASSWORD,
      role: "owner",
    });
    const actor = actorFrom(owner);

    await updateSettings(
      {
        companyName: "Sanitize Test Co",
        largeExpenseAlertPaise: 10_000_00,
        lowBalanceDefaultPaise: 5_000_00,
        dueSoonDays: 3,
        financialYearStartMonth: 4,
        goLiveDate: null,
      },
      actor
    );

    const { rows } = await listAuditLogs({ action: "SETTINGS_UPDATED" });
    expect(rows).toHaveLength(1);

    const after = rows[0]!.after as Record<string, unknown>;
    expect(typeof after.updatedBy).toBe("string");
    expect(after.updatedBy).toBe(actor.id);

    // A full JSON round-trip must survive without throwing — the definitive
    // "is this actually a plain, Client-Component-safe value" check.
    expect(() => JSON.stringify(rows[0]!)).not.toThrow();
  });

  it("returns null (not undefined) for CLIENT_CREATED, whose logAudit call never passes a before", async () => {
    const owner = await seedUser({
      name: "OwnerAuditNull",
      email: `audit-null-${Date.now()}@example.com`,
      password: PASSWORD,
      role: "owner",
    });
    const actor = actorFrom(owner);
    await createClient(
      {
        name: "Audit Null Co",
        service: "Bookkeeping",
        engagementType: "retainer",
        amountPaise: 5_000_00,
        nextDueDate: new Date("2026-08-01T00:00:00.000Z"),
      },
      actor
    );

    const { rows } = await listAuditLogs({ action: "CLIENT_CREATED" });
    expect(rows[0]!.before).toBeNull();
  });
});
