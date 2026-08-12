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
  applyRepaymentToBorrowing,
  countRepaymentsByBorrowing,
  findBorrowingById,
  findBorrowingByIdempotencyKey,
  findBorrowingsPaginated,
  findRepaymentByIdempotencyKey,
  findRepaymentsForBorrowing,
  insertBorrowing,
  insertRepayment,
  markBorrowingWrittenOff,
  sumOutstandingBorrowings,
  type BorrowingListFilter,
} from "@/server/repositories/borrowings.repository";
import { insertTransaction } from "@/server/repositories/transactions.repository";
import { logAudit } from "@/server/services/audit.service";
import type { AuthedUser } from "@/server/auth/guards";
import type {
  CreateBorrowingInput,
  RecordRepaymentInput,
  WriteOffBorrowingInput,
} from "@/schemas/borrowing.schema";
import type { BorrowingRow, RepaymentRow } from "@/types/borrowing";

export type { BorrowingListFilter };

export async function listBorrowings(filter: BorrowingListFilter) {
  const { rows, total, page, pageSize } = await findBorrowingsPaginated(filter);
  const accountIds = [...new Set(rows.map((r) => r.accountId.toString()))];
  const [accounts, repaymentCounts] = await Promise.all([
    findAccountsByIds(accountIds),
    countRepaymentsByBorrowing(rows.map((r) => r._id.toString())),
  ]);
  const nameById = new Map(accounts.map((a) => [a._id.toString(), a.name]));

  const items: BorrowingRow[] = rows.map((r) => ({
    id: r._id.toString(),
    borrowerName: r.borrowerName,
    borrowerPhone: r.borrowerPhone ?? null,
    principalPaise: r.principalPaise,
    repaidPaise: r.repaidPaise,
    outstandingPaise: r.principalPaise - r.repaidPaise,
    lentAt: r.lentAt.toISOString(),
    expectedBackBy: r.expectedBackBy ? r.expectedBackBy.toISOString() : null,
    accountId: r.accountId.toString(),
    accountName: nameById.get(r.accountId.toString()) ?? "",
    reason: r.reason ?? null,
    note: r.note ?? null,
    status: r.status as BorrowingRow["status"],
    writtenOffReason: r.writtenOffReason ?? null,
    repaymentCount: repaymentCounts.get(r._id.toString()) ?? 0,
  }));

  return { rows: items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}

export async function getBorrowingDetail(borrowingId: string) {
  const borrowing = await findBorrowingById(borrowingId);
  if (!borrowing) return null;

  const repayments = await findRepaymentsForBorrowing(borrowingId);
  const accountIds = [
    borrowing.accountId.toString(),
    ...repayments.map((r) => r.accountId.toString()),
  ];
  const accounts = await findAccountsByIds([...new Set(accountIds)]);
  const nameById = new Map(accounts.map((a) => [a._id.toString(), a.name]));

  const rows: RepaymentRow[] = repayments.map((r) => ({
    id: r._id.toString(),
    amountPaise: r.amountPaise,
    receivedAt: r.receivedAt.toISOString(),
    accountId: r.accountId.toString(),
    accountName: nameById.get(r.accountId.toString()) ?? "",
    method: r.method ?? "cash",
    note: r.note ?? null,
    status: r.status as "active" | "reversed",
  }));

  return { repayments: rows };
}

/** Drives the "still out with people" figure on the Borrowers page. */
export async function getOutstandingBorrowedTotal() {
  return sumOutstandingBorrowings();
}

/**
 * Section 6.9 — lend money out.
 *
 * Mirrors createExpense's guards deliberately: same account checks, same
 * reconcile lock, same future-date rule, same owner-only negative-balance
 * override. Cash leaving to a borrower is exactly as constrained as cash
 * leaving to a vendor — what differs is only that this one is expected back.
 */
export async function createBorrowing(input: CreateBorrowingInput, actor: AuthedUser) {
  return runWithIdempotency({
    fetchExisting: async () => {
      const borrowing = await findBorrowingByIdempotencyKey(input.idempotencyKey);
      if (!borrowing) return null;
      const account = await findAccountById(borrowing.accountId.toString());
      return { borrowing, accountNewBalance: account?.currentBalancePaise ?? 0 };
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
            "This account is locked pending reconciliation. Resolve it in Settings before lending."
          );
        }
        if (isAfterTodayIST(input.lentAt)) {
          throw new AppError("VALIDATION", "Lending date cannot be in the future.");
        }

        const wouldBePaise = account.currentBalancePaise - input.principalPaise;
        const effectiveOverride = input.overrideNegativeBalance === true && actor.role === "owner";
        if (wouldBePaise < 0 && !effectiveOverride) {
          throw new AppError(
            "INSUFFICIENT_BALANCE",
            `${account.name} has ${formatINR(account.currentBalancePaise)}. Lending this needs ${formatINR(-wouldBePaise)} more.`,
            { data: { balancePaise: account.currentBalancePaise, shortfallPaise: -wouldBePaise } }
          );
        }

        const borrowingId = new Types.ObjectId();
        const transactionId = new Types.ObjectId();

        await insertTransaction(
          {
            _id: transactionId,
            type: "LOAN_OUT",
            direction: "OUT",
            amountPaise: input.principalPaise,
            accountId: input.accountId,
            occurredAt: input.lentAt,
            monthKey: toMonthKey(input.lentAt),
            counterpartyLabel: input.borrowerName,
            idempotencyKey: input.idempotencyKey,
            createdBy: actor.id,
          },
          session
        );

        const borrowing = await insertBorrowing(
          {
            _id: borrowingId,
            borrowerName: input.borrowerName,
            borrowerPhone: input.borrowerPhone ?? null,
            principalPaise: input.principalPaise,
            lentAt: input.lentAt,
            accountId: input.accountId,
            reason: input.reason ?? null,
            note: input.note ?? null,
            expectedBackBy: input.expectedBackBy ?? null,
            attachments: stampAttachments(input.attachments, actor.id),
            transactionId,
            idempotencyKey: input.idempotencyKey,
            createdBy: actor.id,
          },
          session
        );

        const updatedAccount = await incrementAccountBalance(
          input.accountId,
          -input.principalPaise,
          session
        );
        if (!updatedAccount) throw new AppError("VALIDATION", "Selected account is not active");

        await logAudit(
          {
            actorUserId: actor.id,
            actorName: actor.name,
            action: "BORROWING_CREATED",
            entity: { kind: "borrowing", id: borrowingId },
            after: {
              borrowerName: input.borrowerName,
              principalPaise: input.principalPaise,
              overrideNegativeBalance: effectiveOverride,
            },
            summary: `${actor.name} lent ${formatINR(input.principalPaise)} to ${input.borrowerName} from ${account.name}${effectiveOverride ? " (balance override)" : ""}`,
          },
          session
        );

        return {
          borrowing: borrowing.toObject(),
          accountNewBalance: updatedAccount.currentBalancePaise,
        };
      }),
  });
}

/**
 * Section 6.9 — "haan, itna paisa aa gaya". Money comes back in.
 *
 * Overpayment is refused rather than absorbed: being handed more than is
 * outstanding means either the amount or the loan is wrong, and quietly
 * banking the difference would turn an unrecorded gift or a typo into a
 * balance nobody can explain later. The caller is told exactly what is left.
 */
export async function recordRepayment(input: RecordRepaymentInput, actor: AuthedUser) {
  return runWithIdempotency({
    fetchExisting: async () => {
      const repayment = await findRepaymentByIdempotencyKey(input.idempotencyKey);
      if (!repayment) return null;
      const borrowing = await findBorrowingById(repayment.borrowingId.toString());
      if (!borrowing) return null;
      const account = await findAccountById(repayment.accountId.toString());
      return {
        repayment: { _id: repayment._id, accountId: repayment.accountId },
        borrowing,
        accountNewBalance: account?.currentBalancePaise ?? 0,
      };
    },
    run: () =>
      withDbTransaction(async (session) => {
        const borrowing = await findBorrowingById(input.borrowingId);
        if (!borrowing) throw new AppError("NOT_FOUND", "Borrowing not found");
        if (borrowing.status !== "open") {
          throw new AppError(
            "CONFLICT",
            borrowing.status === "settled"
              ? "This loan is already fully repaid."
              : "This loan was written off. Reverse the write-off before recording a repayment."
          );
        }

        const account = await findAccountById(input.accountId);
        if (!account || account.status !== "active") {
          throw new AppError("VALIDATION", "Selected account is not active");
        }
        if (isAfterTodayIST(input.receivedAt)) {
          throw new AppError("VALIDATION", "Repayment date cannot be in the future.");
        }

        const outstandingPaise = borrowing.principalPaise - borrowing.repaidPaise;
        if (input.amountPaise > outstandingPaise) {
          throw new AppError(
            "VALIDATION",
            `Only ${formatINR(outstandingPaise)} is still owed. Record ${formatINR(outstandingPaise)} or less.`,
            { data: { outstandingPaise } }
          );
        }

        const repaymentId = new Types.ObjectId();
        const transactionId = new Types.ObjectId();

        await insertTransaction(
          {
            _id: transactionId,
            type: "LOAN_REPAY_IN",
            direction: "IN",
            amountPaise: input.amountPaise,
            accountId: input.accountId,
            occurredAt: input.receivedAt,
            monthKey: toMonthKey(input.receivedAt),
            counterpartyLabel: borrowing.borrowerName,
            idempotencyKey: input.idempotencyKey,
            createdBy: actor.id,
          },
          session
        );

        await insertRepayment(
          {
            _id: repaymentId,
            borrowingId: input.borrowingId,
            amountPaise: input.amountPaise,
            receivedAt: input.receivedAt,
            accountId: input.accountId,
            ...(input.method ? { method: input.method } : {}),
            note: input.note ?? null,
            transactionId,
            idempotencyKey: input.idempotencyKey,
            createdBy: actor.id,
          },
          session
        );

        const nextStatus =
          borrowing.repaidPaise + input.amountPaise >= borrowing.principalPaise ? "settled" : "open";

        const updatedBorrowing = await applyRepaymentToBorrowing(
          input.borrowingId,
          borrowing.repaidPaise,
          input.amountPaise,
          nextStatus,
          session
        );
        // Null means a concurrent repayment landed first and `repaidPaise`
        // has moved — roll back rather than double-count against a stale read.
        if (!updatedBorrowing) {
          throw new AppError(
            "CONFLICT",
            "Another repayment was recorded for this loan just now. Reopen and try again."
          );
        }

        const updatedAccount = await incrementAccountBalance(
          input.accountId,
          input.amountPaise,
          session
        );
        if (!updatedAccount) throw new AppError("VALIDATION", "Selected account is not active");

        const stillOwed = updatedBorrowing.principalPaise - updatedBorrowing.repaidPaise;
        await logAudit(
          {
            actorUserId: actor.id,
            actorName: actor.name,
            action: "BORROWING_REPAID",
            entity: { kind: "borrowing", id: borrowing._id },
            before: { repaidPaise: borrowing.repaidPaise, status: borrowing.status },
            after: { repaidPaise: updatedBorrowing.repaidPaise, status: nextStatus },
            summary: `${actor.name} recorded ${formatINR(input.amountPaise)} back from ${borrowing.borrowerName}${stillOwed > 0 ? ` — ${formatINR(stillOwed)} still owed` : " — fully settled"}`,
          },
          session
        );

        return {
          repayment: { _id: repaymentId, accountId: new Types.ObjectId(input.accountId) },
          borrowing: updatedBorrowing,
          accountNewBalance: updatedAccount.currentBalancePaise,
        };
      }),
  });
}

/**
 * Give up on the remainder. No DB transaction and no ledger entry, because
 * no money moves: the cash left the account the day it was lent. This only
 * stops the outstanding figure counting something nobody expects back.
 */
export async function writeOffBorrowing(input: WriteOffBorrowingInput, actor: AuthedUser) {
  const borrowing = await findBorrowingById(input.borrowingId);
  if (!borrowing) throw new AppError("NOT_FOUND", "Borrowing not found");
  if (borrowing.status !== "open") {
    throw new AppError(
      "CONFLICT",
      borrowing.status === "settled"
        ? "This loan is already fully repaid — there is nothing to write off."
        : "This loan is already written off."
    );
  }

  const writtenOff = await markBorrowingWrittenOff(input.borrowingId, actor.id, input.reason);
  if (!writtenOff) {
    throw new AppError("CONFLICT", "This loan changed while you were writing it off.");
  }

  const forgivenPaise = writtenOff.principalPaise - writtenOff.repaidPaise;
  await logAudit({
    actorUserId: actor.id,
    actorName: actor.name,
    action: "BORROWING_WRITTEN_OFF",
    entity: { kind: "borrowing", id: writtenOff._id },
    before: { status: "open" },
    after: { status: "written_off", forgivenPaise, reason: input.reason },
    summary: `${actor.name} wrote off ${formatINR(forgivenPaise)} owed by ${writtenOff.borrowerName} (${input.reason})`,
  });

  return { borrowing: writtenOff, forgivenPaise };
}
