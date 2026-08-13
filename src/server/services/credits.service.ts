import { Types } from "mongoose";

import { AppError } from "@/lib/errors";
import { withDbTransaction } from "@/lib/db-transaction";
import { runWithIdempotency } from "@/lib/idempotency";
import { isAfterTodayIST, toMonthKey } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import { stampAttachments } from "@/lib/attachments";
import {
  findAccountById,
  findAccountsByIds,
  incrementAccountBalance,
} from "@/server/repositories/accounts.repository";
import {
  findCreditByIdempotencyKey,
  findCreditById,
  findCreditsPaginated,
  insertCredit,
  markCreditReversed,
  summariseCreditsOutsideWindow,
  type CreditListFilter,
} from "@/server/repositories/credits.repository";

export type { CreditListFilter };
import { insertTransaction, markTransactionReversed } from "@/server/repositories/transactions.repository";
import { logAudit } from "@/server/services/audit.service";
import type { AuthedUser } from "@/server/auth/guards";
import type { CreateCreditInput, ReverseCreditInput } from "@/schemas/credit.schema";
import type { CreditRow } from "@/types/credit";
import { toOutsideWindowSummary } from "@/lib/date-range";

export type { CreditRow };

/** Section 7.9 — /ledger/credits table. */
export async function listCredits(filter: CreditListFilter) {
  const { rows, total, page, pageSize } = await findCreditsPaginated(filter);
  const accountIds = [...new Set(rows.map((r) => r.accountId.toString()))];
  const accounts = await findAccountsByIds(accountIds);
  const nameById = new Map(accounts.map((a) => [a._id.toString(), a.name]));

  const items: CreditRow[] = rows.map((r) => ({
    id: r._id.toString(),
    amountPaise: r.amountPaise,
    source: r.source,
    reason: r.reason,
    category: r.category,
    accountId: r.accountId.toString(),
    accountName: nameById.get(r.accountId.toString()) ?? "",
    receivedAt: r.receivedAt.toISOString(),
    note: r.note ?? null,
    status: r.status as "active" | "reversed",
    reversedReason: r.reversedReason ?? null,
  }));

  // Only when the window found nothing: an empty table has to be able to
  // tell "none recorded" from "none in these dates", which is exactly what
  // a credit backdated outside the viewed period looks like.
  const outsideWindow =
    total === 0 && (filter.receivedFrom || filter.receivedTo)
      ? toOutsideWindowSummary(await summariseCreditsOutsideWindow(filter))
      : null;

  return {
    rows: items,
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
    outsideWindow,
  };
}

// Section 6.4 — createCredit (mirror of createExpense, direction IN — no
// insufficient-balance rule, since a credit can only ever raise a
// balance).
export async function createCredit(input: CreateCreditInput, actor: AuthedUser) {
  return runWithIdempotency({
    fetchExisting: async () => {
      const credit = await findCreditByIdempotencyKey(input.idempotencyKey);
      if (!credit) return null;
      const account = await findAccountById(credit.accountId.toString());
      return { credit, accountNewBalance: account?.currentBalancePaise ?? 0 };
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
            "This account is locked pending reconciliation. Resolve it in Settings before recording credits."
          );
        }
        if (isAfterTodayIST(input.receivedAt)) {
          throw new AppError("VALIDATION", "Credit date cannot be in the future.");
        }

        const creditId = new Types.ObjectId();
        const transactionId = new Types.ObjectId();
        const monthKey = toMonthKey(input.receivedAt);

        await insertTransaction(
          {
            _id: transactionId,
            type: "CREDIT_IN",
            direction: "IN",
            amountPaise: input.amountPaise,
            accountId: input.accountId,
            occurredAt: input.receivedAt,
            monthKey,
            creditId: creditId.toString(),
            counterpartyLabel: input.source,
            idempotencyKey: input.idempotencyKey,
            createdBy: actor.id,
          },
          session
        );

        const credit = await insertCredit(
          {
            _id: creditId,
            amountPaise: input.amountPaise,
            source: input.source,
            reason: input.reason,
            category: input.category,
            accountId: input.accountId,
            receivedAt: input.receivedAt,
            attachments: stampAttachments(input.attachments, actor.id),
            note: input.note ?? null,
            transactionId,
            idempotencyKey: input.idempotencyKey,
            createdBy: actor.id,
          },
          session
        );

        const updatedAccount = await incrementAccountBalance(input.accountId, input.amountPaise, session);
        if (!updatedAccount) throw new AppError("VALIDATION", "Selected account is not active");

        await logAudit(
          {
            actorUserId: actor.id,
            actorName: actor.name,
            action: "CREDIT_CREATED",
            entity: { kind: "credit", id: creditId },
            after: { amountPaise: credit.amountPaise, category: credit.category, source: credit.source },
            summary: `${actor.name} recorded ${formatINR(input.amountPaise)} credit from ${input.source} into ${account.name}`,
          },
          session
        );

        return { credit: credit.toObject(), accountNewBalance: updatedAccount.currentBalancePaise };
      }),
  });
}

// Mirrors reverseExpense — direction OUT undoes the original IN.
export async function reverseCredit(input: ReverseCreditInput, actor: AuthedUser) {
  return runWithIdempotency({
    fetchExisting: async () => {
      const credit = await findCreditById(input.creditId);
      if (!credit || credit.status !== "reversed") return null;
      const account = await findAccountById(credit.accountId.toString());
      return { credit, accountNewBalance: account?.currentBalancePaise ?? 0 };
    },
    run: () =>
      withDbTransaction(async (session) => {
        const credit = await findCreditById(input.creditId);
        if (!credit) throw new AppError("NOT_FOUND", "Credit not found");
        if (credit.status !== "active") {
          throw new AppError("CONFLICT", "Already reversed. Record a fresh entry instead.");
        }

        await insertTransaction(
          {
            type: "REVERSAL",
            direction: "OUT",
            amountPaise: credit.amountPaise,
            accountId: credit.accountId.toString(),
            occurredAt: new Date(),
            // Section 14 edge case 3's monthKey rule — reuse the original
            // credit's monthKey (derived from receivedAt) so per-account
            // monthly aggregates stay balanced within that month.
            monthKey: toMonthKey(credit.receivedAt),
            creditId: credit._id.toString(),
            reversesTransactionId: credit.transactionId.toString(),
            counterpartyLabel: null,
            idempotencyKey: input.idempotencyKey,
            createdBy: actor.id,
          },
          session
        );

        await markTransactionReversed(credit.transactionId.toString(), session);
        await markCreditReversed(credit._id.toString(), actor.id, input.reason, session);

        const updatedAccount = await incrementAccountBalance(
          credit.accountId.toString(),
          -credit.amountPaise,
          session
        );
        if (!updatedAccount) throw new AppError("VALIDATION", "Account is not active");

        await logAudit(
          {
            actorUserId: actor.id,
            actorName: actor.name,
            action: "CREDIT_REVERSED",
            entity: { kind: "credit", id: credit._id },
            before: { status: credit.status },
            after: { status: "reversed" },
            summary: `${actor.name} reversed credit from ${credit.source} (${input.reason})`,
          },
          session
        );

        return {
          credit: { ...credit, status: "reversed" as const, reversedReason: input.reason },
          accountNewBalance: updatedAccount.currentBalancePaise,
        };
      }),
  });
}
