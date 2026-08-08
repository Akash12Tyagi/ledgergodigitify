import { withDbTransaction } from "@/lib/db-transaction";
import { nowIST } from "@/lib/dates";
import { anchorDayFrom, formatPeriodLabel, nextPeriodAfter, reportingMonthKey } from "@/lib/billing-period";
import { findActiveRetainerClients } from "@/server/repositories/clients.repository";
import {
  findLatestBillingForClient,
  insertBilling,
} from "@/server/repositories/monthly-billings.repository";
import { logAudit } from "@/server/services/audit.service";

export type RolloverResult = {
  ranAt: string;
  scanned: number;
  created: number;
  skipped: number;
  failed: Array<{ clientId: string; clientName: string; error: string }>;
};

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === 11000;
}

/**
 * Upper bound on how many periods one client can be caught up by in a single
 * run. A cron that has been down for a while SHOULD backfill every missed
 * period, so this is set well above any realistic outage — it exists only so
 * a corrupt date can never spin this loop forever. Hitting it is reported as
 * a failure rather than silently truncating a client's billing history.
 */
const MAX_CATCHUP_PERIODS = 36;

/**
 * The recurring-billing job: raise the next period for every active retainer
 * whose current period has ended.
 *
 * Two things changed here versus the original month-keyed version, both of
 * which were producing wrong money:
 *
 * 1. Periods advance from the client's OWN last period, not from today's
 *    calendar month. The old version asked "does a billing exist for
 *    2026-08?" and, finding none for a client whose first due was 5 Sep,
 *    billed them for August anyway — with a due date of 5 Aug, already in
 *    the past, so a brand-new client was instantly overdue for a period
 *    nobody had agreed to. Advancing from real history makes back-billing
 *    structurally impossible.
 *
 * 2. Nothing carries forward. An unpaid remainder stays on the period it
 *    belongs to; the next period is raised at the client's full rate. The
 *    old version MOVED the shortfall into the new period and marked the old
 *    one FULLY_PAID, which made a genuinely unpaid month read as settled in
 *    every history view and receipt.
 *
 * Idempotency is state-based: what exists in the database is the only signal
 * consulted, so running this five times in a row, or twice concurrently,
 * produces exactly one billing per client-period. A missed day self-heals on
 * the next run because there is no "did I run today" flag to miss.
 */
export async function runRollover(actorId: string, actorName: string): Promise<RolloverResult> {
  const clients = await findActiveRetainerClients();
  const nowMs = nowIST().getTime();

  let created = 0;
  let skipped = 0;
  const failed: RolloverResult["failed"] = [];

  for (const client of clients) {
    const clientId = client._id.toString();

    try {
      const latest = await findLatestBillingForClient(clientId);
      if (!latest) {
        // No history to advance from. createClient always raises the first
        // due, so this only happens if every due was deleted by hand — in
        // which case guessing a period would be inventing money.
        skipped += 1;
        continue;
      }

      if (!latest.periodStart || !latest.periodEnd) {
        failed.push({
          clientId,
          clientName: client.name,
          error:
            "Latest due has no billing period — run scripts/migrate-billing-periods.ts before rolling over.",
        });
        continue;
      }

      // The anchor comes from the client, not from the last period's start
      // date, which may have been clamped (an anchor of 31 lands on 28 Feb).
      // Re-deriving it from a clamped start would walk the billing date
      // permanently backwards.
      const anchorDay = client.billingDay ?? anchorDayFrom(latest.periodStart);

      let cursor = { periodStart: latest.periodStart, periodEnd: latest.periodEnd };
      let createdForClient = 0;

      // A period becomes billable the moment it starts — which is exactly
      // when the previous one ends, since retainers are collected up front.
      while (cursor.periodEnd.getTime() <= nowMs) {
        if (createdForClient >= MAX_CATCHUP_PERIODS) {
          failed.push({
            clientId,
            clientName: client.name,
            error: `Stopped after ${MAX_CATCHUP_PERIODS} catch-up periods — check this client's billing dates.`,
          });
          break;
        }

        const next = nextPeriodAfter(cursor, anchorDay);

        await withDbTransaction(async (session) => {
          const billing = await insertBilling(
            {
              clientId,
              periodStart: next.periodStart,
              periodEnd: next.periodEnd,
              monthKey: reportingMonthKey(next.periodStart),
              billedPaise: client.amountPaise,
              // Collected up front: the money for a period is owed on the
              // day that period begins.
              dueDate: next.periodStart,
              generatedBy: "rollover",
            },
            session
          );

          await logAudit(
            {
              actorUserId: actorId,
              actorName,
              action: "BILLING_GENERATED",
              entity: { kind: "billing", id: billing._id },
              after: {
                clientId,
                period: formatPeriodLabel(next.periodStart, next.periodEnd),
                billedPaise: billing.billedPaise,
              },
              summary: `Generated ${formatPeriodLabel(next.periodStart, next.periodEnd)} due for "${client.name}"`,
            },
            session
          );
        });

        cursor = next;
        createdForClient += 1;
      }

      if (createdForClient === 0) skipped += 1;
      created += createdForClient;
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        // A concurrent/overlapping run already created this exact
        // {clientId, periodStart}. That is the idempotency guarantee doing
        // its job, not a failure.
        skipped += 1;
        continue;
      }
      failed.push({
        clientId,
        clientName: client.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    ranAt: new Date().toISOString(),
    scanned: clients.length,
    created,
    skipped,
    failed,
  };
}
