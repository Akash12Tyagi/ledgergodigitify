import { AppError } from "@/lib/errors";
import { withDbTransaction } from "@/lib/db-transaction";
import { runWithIdempotency } from "@/lib/idempotency";
import { isAfterTodayIST, toMonthKey, todayIST } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import {
  findAccountById,
  incrementAccountBalance,
} from "@/server/repositories/accounts.repository";
import {
  findTransactionByIdempotencyKey,
  insertTransaction,
} from "@/server/repositories/transactions.repository";
import { getSettingsOrDefaults } from "@/server/repositories/settings.repository";
import { logAudit } from "@/server/services/audit.service";
import { notify } from "@/server/services/notifications.service";
import type { AuthedUser } from "@/server/auth/guards";
import type { AdjustAccountInput } from "@/schemas/account.schema";

/**
 * Manual balance corrections.
 *
 * The alternative — letting someone type a new balance over the old one, or
 * editing `openingBalancePaise` after the fact — would silently restate every
 * historical figure derived from that account and leave the audit trail
 * describing amounts that no longer reconcile. An adjustment is a real,
 * dated, reversible-by-record transaction instead: the correction appears in
 * account activity next to everything else, with an author and a reason.
 *
 * Because it moves a real balance, it is also counted in the month overview's
 * netCashFlow (financial-engine's `adjustmentsNetPaise`). Leaving it out of
 * that equation would make closing != opening + net and blank the entire
 * month behind the reconciliation banner.
 */
export async function adjustAccount(input: AdjustAccountInput, actor: AuthedUser) {
  return runWithIdempotency({
    fetchExisting: async () => {
      const tx = await findTransactionByIdempotencyKey(input.idempotencyKey);
      if (!tx) return null;
      const account = await findAccountById(tx.accountId.toString());
      return {
        transactionId: tx._id.toString(),
        accountNewBalance: account?.currentBalancePaise ?? 0,
      };
    },
    run: () =>
      withDbTransaction(async (session) => {
        const account = await findAccountById(input.accountId);
        if (!account || account.status !== "active") {
          throw new AppError("VALIDATION", "Selected account is not active");
        }
        if (account.reconcileLock) {
          throw new AppError(
            "LOCKED",
            "This account is locked pending reconciliation. Resolve it in Settings first."
          );
        }
        if (isAfterTodayIST(input.occurredAt)) {
          throw new AppError("VALIDATION", "Adjustment date cannot be in the future.");
        }

        const deltaPaise = input.direction === "IN" ? input.amountPaise : -input.amountPaise;

        // No insufficient-balance guard here, unlike expenses. An adjustment
        // exists to make the ledger match reality; if reality is that the
        // account is short, refusing to record it would force the operator to
        // leave the books knowingly wrong. It is admin-gated and audited
        // instead.
        const transaction = await insertTransaction(
          {
            type: "ADJUSTMENT",
            direction: input.direction,
            amountPaise: input.amountPaise,
            accountId: input.accountId,
            occurredAt: input.occurredAt,
            monthKey: toMonthKey(input.occurredAt),
            counterpartyLabel: "Balance adjustment",
            note: input.reason,
            idempotencyKey: input.idempotencyKey,
            createdBy: actor.id,
          },
          session
        );

        const updatedAccount = await incrementAccountBalance(input.accountId, deltaPaise, session);
        if (!updatedAccount) throw new AppError("VALIDATION", "Selected account is not active");

        const settings = await getSettingsOrDefaults();
        const threshold = account.lowBalanceThresholdPaise ?? settings.lowBalanceDefaultPaise;
        if (updatedAccount.currentBalancePaise < threshold) {
          await notify(
            {
              type: "LOW_BALANCE",
              severity: "warning",
              title: "Low balance",
              body: `${account.name} is now at ${formatINR(updatedAccount.currentBalancePaise)}`,
              entityRef: { kind: "account", id: input.accountId },
              href: `/ledger/accounts/${input.accountId}`,
              audience: "all",
              dedupeKey: `LOWBAL:${input.accountId}:${todayIST()}`,
            },
            session
          );
        }

        await logAudit(
          {
            actorUserId: actor.id,
            actorName: actor.name,
            action: "ACCOUNT_ADJUSTED",
            entity: { kind: "account", id: account._id },
            before: { currentBalancePaise: account.currentBalancePaise },
            after: {
              currentBalancePaise: updatedAccount.currentBalancePaise,
              direction: input.direction,
              amountPaise: input.amountPaise,
              reason: input.reason,
            },
            summary: `${actor.name} adjusted ${account.name} by ${input.direction === "IN" ? "+" : "−"}${formatINR(input.amountPaise)} — ${input.reason}`,
          },
          session
        );

        return {
          transactionId: transaction._id.toString(),
          accountNewBalance: updatedAccount.currentBalancePaise,
        };
      }),
  });
}
