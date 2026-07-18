import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { resolveReconciliation, runReconciliation } from "@/server/services/reconciliation.service";
import { AccountModel } from "@/database/models/account.model";
import { NotificationModel } from "@/database/models/notification.model";
import { AuditLogModel } from "@/database/models/audit-log.model";
import { seedAccount } from "../../helpers/seed-financial";
import { seedUser, clearAllCollections } from "../../helpers/seed-user";
import type { AuthedUser } from "@/server/auth/guards";

const PASSWORD = "Correct-Horse-Battery-Staple-9";

function actorFrom(user: { _id: unknown; name: string; email: string; role: string }): AuthedUser {
  return { id: String(user._id), name: user.name, email: user.email, role: user.role as AuthedUser["role"] };
}

afterEach(async () => {
  await clearAllCollections();
});

describe("reconciliation.service — runReconciliation (Section 6.8D / edge case 24)", () => {
  it("locks an account whose derived balance disagrees with its materialized balance, and notifies", async () => {
    const account = await seedAccount({ openingBalancePaise: 10_000_00, currentBalancePaise: 10_000_00 });

    // Corrupt the materialized balance directly, bypassing every service
    // (exactly the "genuine drift" scenario reconcileAccount exists for).
    await AccountModel.updateOne({ _id: account._id }, { $set: { currentBalancePaise: 999_00 } });

    const result = await runReconciliation();
    expect(result.hasDrift).toBe(true);
    expect(result.lockedAccountIds).toContain(account._id.toString());

    const refreshed = await AccountModel.findById(account._id).lean();
    expect(refreshed?.reconcileLock).toBe(true);

    const notification = await NotificationModel.findOne({ type: "RECONCILIATION_DRIFT" }).lean();
    expect(notification).not.toBeNull();
    expect(notification?.audience).toBe("owner");

    const audit = await AuditLogModel.findOne({ action: "RECONCILE_DRIFT_DETECTED" }).lean();
    expect(audit).not.toBeNull();

    const cronAudit = await AuditLogModel.findOne({ action: "RECONCILE_RUN" }).lean();
    expect(cronAudit).not.toBeNull();
  });

  it("leaves a clean account unlocked and reports no drift", async () => {
    await seedAccount({ openingBalancePaise: 5_000_00, currentBalancePaise: 5_000_00 });

    const result = await runReconciliation();
    expect(result.hasDrift).toBe(false);
    expect(result.lockedAccountIds).toHaveLength(0);
  });

  it("a locked account genuinely blocks money mutations until resolved (proves the lock has teeth)", async () => {
    const owner = await seedUser({ name: "Owner2", email: `rec2-${Date.now()}@example.com`, password: PASSWORD, role: "owner" });
    const actor = actorFrom(owner);
    const account = await seedAccount({ openingBalancePaise: 10_000_00, currentBalancePaise: 10_000_00 });

    await AccountModel.updateOne({ _id: account._id }, { $set: { currentBalancePaise: 1_00 } });
    await runReconciliation();

    const { createExpense } = await import("@/server/services/expenses.service");
    await expect(
      createExpense(
        {
          amountPaise: 100_00,
          reason: "Should be blocked",
          paidToEntity: "Vendor",
          category: "misc",
          accountId: account._id.toString(),
          spentAt: new Date(),
          idempotencyKey: randomUUID(),
        },
        actor
      )
    ).rejects.toMatchObject({ code: "LOCKED" });
  });
});

describe("reconciliation.service — resolveReconciliation", () => {
  it("clears the lock when the owner resolves it, and audits the resolution", async () => {
    const owner = await seedUser({ name: "Owner3", email: `rec3-${Date.now()}@example.com`, password: PASSWORD, role: "owner" });
    const actor = actorFrom(owner);
    const account = await seedAccount({ openingBalancePaise: 10_000_00, currentBalancePaise: 10_000_00, reconcileLock: true });

    const resolved = await resolveReconciliation(account._id.toString(), actor);
    expect(resolved.reconcileLock).toBe(false);

    const audit = await AuditLogModel.findOne({ action: "RECONCILE_RESOLVED" }).lean();
    expect(audit).not.toBeNull();
  });

  it("rejects a non-owner attempting to resolve a lock", async () => {
    const admin = await seedUser({ name: "Admin", email: `rec4-${Date.now()}@example.com`, password: PASSWORD, role: "admin" });
    const actor = actorFrom(admin);
    const account = await seedAccount({ reconcileLock: true });

    await expect(resolveReconciliation(account._id.toString(), actor)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
