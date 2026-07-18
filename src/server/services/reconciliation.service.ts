import { AppError } from "@/lib/errors";
import { formatINR } from "@/lib/money";
import { todayIST } from "@/lib/dates";
import { setAccountReconcileLock } from "@/server/repositories/accounts.repository";
import { reconcileAll } from "@/server/services/financial-engine";
import { logAudit } from "@/server/services/audit.service";
import { notify } from "@/server/services/notifications.service";
import { SYSTEM_ACTOR_ID, SYSTEM_ACTOR_NAME } from "@/constants/system";
import type { AuthedUser } from "@/server/auth/guards";

export type ReconciliationRunResult = {
  hasDrift: boolean;
  lockedAccountIds: string[];
};

/**
 * Section 6.8D/14 edge case 24 — daily reconciliation. For any account
 * where the derived (ledger-computed) balance disagrees with the
 * materialized `currentBalancePaise`, the account is locked (every
 * money-mutating service already refuses to act on a locked account,
 * M3/M4) and a critical notification is raised — deduped per account per
 * IST day so a persistent drift re-alerts daily instead of going silent
 * after the first run, but never floods on every cron retry within a day.
 */
export async function runReconciliation(): Promise<ReconciliationRunResult> {
  const report = await reconcileAll();
  const lockedAccountIds: string[] = [];

  for (const result of report.accounts) {
    if (result.driftPaise === 0) continue;

    const updated = await setAccountReconcileLock(result.accountId, true);
    if (!updated) continue;
    lockedAccountIds.push(result.accountId);

    await notify({
      type: "RECONCILIATION_DRIFT",
      severity: "critical",
      title: "Reconciliation drift detected",
      body: `${result.name} shows a drift of ${formatINR(result.driftPaise)}. Mutations are locked until resolved.`,
      entityRef: { kind: "account", id: result.accountId },
      href: `/ledger/accounts/${result.accountId}`,
      audience: "owner",
      dedupeKey: `DRIFT:${result.accountId}:${todayIST()}`,
    });

    await logAudit({
      actorUserId: SYSTEM_ACTOR_ID,
      actorName: SYSTEM_ACTOR_NAME,
      action: "RECONCILE_DRIFT_DETECTED",
      entity: { kind: "account", id: result.accountId },
      after: {
        driftPaise: result.driftPaise,
        derivedPaise: result.derivedPaise,
        materializedPaise: result.materializedPaise,
      },
      summary: `Reconciliation drift of ${formatINR(result.driftPaise)} detected on "${result.name}"; account locked.`,
    });
  }

  await logAudit({
    actorUserId: SYSTEM_ACTOR_ID,
    actorName: SYSTEM_ACTOR_NAME,
    action: "RECONCILE_RUN",
    entity: { kind: "system", id: null },
    summary: `Reconciliation run across ${report.accounts.length} account(s); ${lockedAccountIds.length} locked.`,
  });

  return { hasDrift: lockedAccountIds.length > 0, lockedAccountIds };
}

/**
 * Section 14 edge case 24 — "owner resolves in Settings." The /settings
 * trigger for this lands in M7; the resolve mechanism itself must exist
 * now since M6 is what creates the lock in the first place.
 */
export async function resolveReconciliation(accountId: string, actor: AuthedUser) {
  if (actor.role !== "owner") {
    throw new AppError("FORBIDDEN", "Only the owner can resolve a reconciliation lock.");
  }

  const updated = await setAccountReconcileLock(accountId, false);
  if (!updated) throw new AppError("NOT_FOUND", "Account not found");

  await logAudit({
    actorUserId: actor.id,
    actorName: actor.name,
    action: "RECONCILE_RESOLVED",
    entity: { kind: "account", id: accountId },
    after: { reconcileLock: false },
    summary: `${actor.name} resolved the reconciliation lock on "${updated.name}"`,
  });

  return updated;
}
