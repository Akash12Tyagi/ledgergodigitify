import { withDbTransaction } from "@/lib/db-transaction";
import { clampBillingDay, dayOfMonthIST, nowIST, toMonthKey } from "@/lib/dates";
import { findActiveRetainerClients } from "@/server/repositories/clients.repository";
import {
  findBillingByClientAndMonth,
  findBillingsByClient,
  insertBilling,
  setBillingCarriedOut,
} from "@/server/repositories/monthly-billings.repository";
import { computeOverpaymentSurplus, deriveBillingStatus } from "@/server/services/financial-engine";
import { logAudit } from "@/server/services/audit.service";

export type RolloverResult = {
  monthKey: string;
  scanned: number;
  created: number;
  skipped: number;
  failed: Array<{ clientId: string; error: string }>;
};

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === 11000;
}

/**
 * Section 6.8A — the daily rollover cron. Only active retainer clients are
 * scanned (Section 14 edge case 16: paused clients are skipped by the
 * repository's status:"active" filter, never back-billed on resume).
 * State-based idempotency (Section 14 edge case 41/42): existence of a
 * MonthlyBilling for {clientId, monthKey} is the only signal checked —
 * running this 5x in a row produces exactly one billing per client-month,
 * and a missed day self-heals on the next successful run since there's no
 * "did I run today" flag to miss.
 */
export async function runRollover(actorId: string, actorName: string): Promise<RolloverResult> {
  const monthKey = toMonthKey(nowIST());
  const clients = await findActiveRetainerClients();

  let created = 0;
  let skipped = 0;
  const failed: Array<{ clientId: string; error: string }> = [];

  for (const client of clients) {
    const clientId = client._id.toString();

    try {
      const existing = await findBillingByClientAndMonth(clientId, monthKey);
      if (existing) {
        skipped += 1;
        continue;
      }

      await withDbTransaction(async (session) => {
        const billingDay = client.billingDay ?? dayOfMonthIST(client.nextDueDate);
        const [year, month] = monthKey.split("-").map(Number) as [number, number];
        const dueDate = clampBillingDay(year, month, billingDay);

        // Carry-as-a-MOVE: find the most recent billing strictly before
        // this month and move its unpaid remainder (or overpaid surplus)
        // forward, per Section 6.8A.
        const priorBillings = await findBillingsByClient(clientId); // sorted desc by monthKey
        const prior = priorBillings.find((b) => b.monthKey < monthKey);

        let carriedInPaise = 0;
        if (prior) {
          const { remainingPaise } = deriveBillingStatus(prior);
          if (remainingPaise > 0) {
            carriedInPaise = remainingPaise;
            await setBillingCarriedOut(prior._id.toString(), remainingPaise, "FULLY_PAID", session);
          } else {
            const surplus = computeOverpaymentSurplus(prior);
            if (surplus > 0) {
              carriedInPaise = -surplus;
              await setBillingCarriedOut(prior._id.toString(), surplus, "FULLY_PAID", session);
            }
          }
        }

        const billing = await insertBilling(
          {
            clientId,
            monthKey,
            billedPaise: client.amountPaise,
            carriedInPaise,
            dueDate,
            generatedBy: "rollover",
          },
          session
        );

        await logAudit(
          {
            actorUserId: actorId,
            actorName,
            action: "BILLING_GENERATED",
            entity: { kind: "client", id: client._id },
            after: { monthKey, billedPaise: billing.billedPaise, carriedInPaise },
            summary:
              `Rollover generated ${monthKey} billing for "${client.name}"` +
              (carriedInPaise !== 0
                ? ` (carried ${carriedInPaise > 0 ? "in" : "out"} ${Math.abs(carriedInPaise)} paise)`
                : ""),
          },
          session
        );
      });

      created += 1;
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        // Section 14 edge case 41 — a concurrent/overlapping cron run
        // already created this exact {clientId, monthKey}; that's a
        // no-op, not a failure.
        skipped += 1;
        continue;
      }
      failed.push({ clientId, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return { monthKey, scanned: clients.length, created, skipped, failed };
}
