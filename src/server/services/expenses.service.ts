import { Types } from "mongoose";

import { AppError } from "@/lib/errors";
import { withDbTransaction } from "@/lib/db-transaction";
import { runWithIdempotency } from "@/lib/idempotency";
import { isAfterTodayIST, toMonthKey, todayIST } from "@/lib/dates";
import { formatPeriodLabel } from "@/lib/billing-period";
import { formatINR } from "@/lib/money";
import { stampAttachments } from "@/lib/attachments";
import type { ExpenseStatus } from "@/constants/domain";
import {
  findAccountById,
  findAccountsByIds,
  incrementAccountBalance,
} from "@/server/repositories/accounts.repository";
import {
  countPendingExpenses,
  findExpenseByIdempotencyKey,
  findExpenseById,
  findExpensesPaginated,
  insertExpense,
  markExpenseApproved,
  markExpenseReversed,
  markPendingExpenseCancelled,
  updatePendingExpenseOptimistic,
  type ExpenseListFilter,
} from "@/server/repositories/expenses.repository";

export type { ExpenseListFilter };
import { insertTransaction, markTransactionReversed } from "@/server/repositories/transactions.repository";
import { getSettingsOrDefaults } from "@/server/repositories/settings.repository";
import { logAudit } from "@/server/services/audit.service";
import { notify } from "@/server/services/notifications.service";
import type { AuthedUser } from "@/server/auth/guards";
import type {
  ApproveExpenseInput,
  CancelPendingExpenseInput,
  CreateExpenseInput,
  ReverseExpenseInput,
  UpdatePendingExpenseInput,
} from "@/schemas/expense.schema";
import type { ExpenseRow } from "@/types/expense";

export type { ExpenseRow };

/** Section 7.6 — /ledger/expenses table (Section 9: batched account-name
 * lookup, no N+1). */
export async function listExpenses(filter: ExpenseListFilter) {
  const { rows, total, page, pageSize } = await findExpensesPaginated(filter);
  const accountIds = [...new Set(rows.map((r) => r.accountId.toString()))];
  const accounts = await findAccountsByIds(accountIds);
  const nameById = new Map(accounts.map((a) => [a._id.toString(), a.name]));

  const items: ExpenseRow[] = rows.map((r) => ({
    id: r._id.toString(),
    amountPaise: r.amountPaise,
    reason: r.reason,
    paidToEntity: r.paidToEntity,
    category: r.category,
    accountId: r.accountId.toString(),
    accountName: nameById.get(r.accountId.toString()) ?? "",
    spentAt: r.spentAt.toISOString(),
    note: r.note ?? null,
    status: r.status as ExpenseStatus,
    reversedReason: r.reversedReason ?? null,
    overrideNegativeBalance: r.overrideNegativeBalance,
    templateId: r.templateId ? r.templateId.toString() : null,
    periodLabel:
      r.periodStart && r.periodEnd ? formatPeriodLabel(r.periodStart, r.periodEnd) : null,
    version: r.version,
  }));

  return { rows: items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}

// Section 6.3 — createExpense.
export async function createExpense(input: CreateExpenseInput, actor: AuthedUser) {
  return runWithIdempotency({
    fetchExisting: async () => {
      const expense = await findExpenseByIdempotencyKey(input.idempotencyKey);
      if (!expense) return null;
      const account = await findAccountById(expense.accountId.toString());
      return { expense, accountNewBalance: account?.currentBalancePaise ?? 0 };
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
            "This account is locked pending reconciliation. Resolve it in Settings before recording expenses."
          );
        }
        if (isAfterTodayIST(input.spentAt)) {
          throw new AppError("VALIDATION", "Expense date cannot be in the future.");
        }

        // Step 2 — insufficient-balance rule. Owner-only override, and
        // only honored if the actor actually is the owner (Section 6.3:
        // a non-owner's overrideNegativeBalance flag is silently ignored,
        // not a validation error).
        const wouldBePaise = account.currentBalancePaise - input.amountPaise;
        const effectiveOverride = input.overrideNegativeBalance === true && actor.role === "owner";
        if (wouldBePaise < 0 && !effectiveOverride) {
          throw new AppError(
            "INSUFFICIENT_BALANCE",
            `${account.name} has ${formatINR(account.currentBalancePaise)}. This expense needs ${formatINR(-wouldBePaise)} more.`,
            { data: { balancePaise: account.currentBalancePaise, shortfallPaise: -wouldBePaise } }
          );
        }

        const expenseId = new Types.ObjectId();
        const transactionId = new Types.ObjectId();
        const monthKey = toMonthKey(input.spentAt);

        await insertTransaction(
          {
            _id: transactionId,
            type: "EXPENSE_OUT",
            direction: "OUT",
            amountPaise: input.amountPaise,
            accountId: input.accountId,
            occurredAt: input.spentAt,
            monthKey,
            expenseId: expenseId.toString(),
            counterpartyLabel: input.paidToEntity,
            idempotencyKey: input.idempotencyKey,
            createdBy: actor.id,
          },
          session
        );

        const expense = await insertExpense(
          {
            _id: expenseId,
            amountPaise: input.amountPaise,
            reason: input.reason,
            paidToEntity: input.paidToEntity,
            category: input.category,
            accountId: input.accountId,
            spentAt: input.spentAt,
            attachments: stampAttachments(input.attachments, actor.id),
            note: input.note ?? null,
            transactionId,
            overrideNegativeBalance: effectiveOverride,
            idempotencyKey: input.idempotencyKey,
            createdBy: actor.id,
          },
          session
        );

        const updatedAccount = await incrementAccountBalance(input.accountId, -input.amountPaise, session);
        if (!updatedAccount) throw new AppError("VALIDATION", "Selected account is not active");

        // Step 5 — LARGE_EXPENSE alert.
        const settings = await getSettingsOrDefaults();
        if (input.amountPaise >= settings.largeExpenseAlertPaise) {
          await notify(
            {
              type: "LARGE_EXPENSE",
              severity: "warning",
              title: "Large expense recorded",
              body: `${formatINR(input.amountPaise)} paid to ${input.paidToEntity} from ${account.name}`,
              entityRef: { kind: "expense", id: expenseId.toString() },
              href: `/ledger/expenses`,
              audience: "all",
              dedupeKey: `EXP:${expenseId.toString()}`,
            },
            session
          );
        }

        // Step 6 — LOW_BALANCE alert, deduped per account per IST day.
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
            action: "EXPENSE_CREATED",
            entity: { kind: "expense", id: expenseId },
            after: {
              amountPaise: expense.amountPaise,
              category: expense.category,
              paidToEntity: expense.paidToEntity,
              overrideNegativeBalance: effectiveOverride,
            },
            summary: `${actor.name} recorded ${formatINR(input.amountPaise)} expense to ${input.paidToEntity} from ${account.name}${effectiveOverride ? " (balance override)" : ""}`,
          },
          session
        );

        return { expense: expense.toObject(), accountNewBalance: updatedAccount.currentBalancePaise };
      }),
  });
}

export async function getPendingExpenseCount() {
  return countPendingExpenses();
}

/**
 * Section 6.3.3 — approveExpense. THIS is where a recurring expense becomes
 * money: until now the row was pending, no Transaction existed and no
 * balance had moved.
 *
 * Every guard createExpense runs up front runs here instead, not in
 * addition: at generation time there was nothing to guard, and the account's
 * balance a month ago is irrelevant to whether it can fund the payment
 * today. Role: admin+ (enforced by the action wrapper) — deliberately
 * stricter than recording a one-off expense, because approving is the step
 * that releases money someone else scheduled.
 */
export async function approveExpense(input: ApproveExpenseInput, actor: AuthedUser) {
  return runWithIdempotency({
    fetchExisting: async () => {
      const expense = await findExpenseById(input.expenseId);
      if (!expense || expense.status !== "active") return null;
      const account = await findAccountById(expense.accountId.toString());
      return { expense, accountNewBalance: account?.currentBalancePaise ?? 0 };
    },
    run: () =>
      withDbTransaction(async (session) => {
        const pending = await findExpenseById(input.expenseId);
        if (!pending) throw new AppError("NOT_FOUND", "Expense not found");
        if (pending.status !== "pending") {
          throw new AppError(
            "CONFLICT",
            pending.status === "active"
              ? "This expense has already been approved."
              : `This expense is ${pending.status} and can no longer be approved.`
          );
        }

        const account = await findAccountById(pending.accountId.toString());
        if (!account || account.status !== "active") {
          throw new AppError("VALIDATION", "The account on this expense is not active");
        }
        if (account.reconcileLock) {
          throw new AppError(
            "LOCKED",
            "This account is locked pending reconciliation. Resolve it in Settings before approving."
          );
        }
        if (isAfterTodayIST(input.spentAt)) {
          throw new AppError("VALIDATION", "Expense date cannot be in the future.");
        }

        const wouldBePaise = account.currentBalancePaise - pending.amountPaise;
        const effectiveOverride = input.overrideNegativeBalance === true && actor.role === "owner";
        if (wouldBePaise < 0 && !effectiveOverride) {
          throw new AppError(
            "INSUFFICIENT_BALANCE",
            `${account.name} has ${formatINR(account.currentBalancePaise)}. This expense needs ${formatINR(-wouldBePaise)} more.`,
            { data: { balancePaise: account.currentBalancePaise, shortfallPaise: -wouldBePaise } }
          );
        }

        const transactionId = new Types.ObjectId();
        // monthKey comes from the APPROVED date, not the period: this is a
        // cash ledger, and the money leaves on the day it is approved.
        // August's salary paid on 3 Sep is a September cash movement; the
        // August period it covers is preserved on the expense itself.
        await insertTransaction(
          {
            _id: transactionId,
            type: "EXPENSE_OUT",
            direction: "OUT",
            amountPaise: pending.amountPaise,
            accountId: pending.accountId.toString(),
            occurredAt: input.spentAt,
            monthKey: toMonthKey(input.spentAt),
            expenseId: pending._id.toString(),
            counterpartyLabel: pending.paidToEntity,
            idempotencyKey: input.idempotencyKey,
            createdBy: actor.id,
          },
          session
        );

        const approved = await markExpenseApproved(
          pending._id.toString(),
          {
            transactionId,
            approvedBy: actor.id,
            approvedAt: new Date(),
            spentAt: input.spentAt,
          },
          session
        );
        // Null means a concurrent approval won the race and moved it out of
        // `pending` — roll this one back rather than double-posting.
        if (!approved) {
          throw new AppError("CONFLICT", "This expense was approved by someone else just now.");
        }

        const updatedAccount = await incrementAccountBalance(
          pending.accountId.toString(),
          -pending.amountPaise,
          session
        );
        if (!updatedAccount) throw new AppError("VALIDATION", "The account on this expense is not active");

        const settings = await getSettingsOrDefaults();
        if (pending.amountPaise >= settings.largeExpenseAlertPaise) {
          await notify(
            {
              type: "LARGE_EXPENSE",
              severity: "warning",
              title: "Large expense approved",
              body: `${formatINR(pending.amountPaise)} paid to ${pending.paidToEntity} from ${account.name}`,
              entityRef: { kind: "expense", id: pending._id.toString() },
              href: `/ledger/expenses`,
              audience: "all",
              dedupeKey: `EXP:${pending._id.toString()}`,
            },
            session
          );
        }

        const threshold = account.lowBalanceThresholdPaise ?? settings.lowBalanceDefaultPaise;
        if (updatedAccount.currentBalancePaise < threshold) {
          await notify(
            {
              type: "LOW_BALANCE",
              severity: "warning",
              title: "Low balance",
              body: `${account.name} is now at ${formatINR(updatedAccount.currentBalancePaise)}`,
              entityRef: { kind: "account", id: pending.accountId.toString() },
              href: `/ledger/accounts/${pending.accountId.toString()}`,
              audience: "all",
              dedupeKey: `LOWBAL:${pending.accountId.toString()}:${todayIST()}`,
            },
            session
          );
        }

        await logAudit(
          {
            actorUserId: actor.id,
            actorName: actor.name,
            action: "EXPENSE_APPROVED",
            entity: { kind: "expense", id: pending._id },
            before: { status: "pending" },
            after: {
              status: "active",
              amountPaise: pending.amountPaise,
              overrideNegativeBalance: effectiveOverride,
            },
            summary: `${actor.name} approved ${formatINR(pending.amountPaise)} to ${pending.paidToEntity} from ${account.name}${effectiveOverride ? " (balance override)" : ""}`,
          },
          session
        );

        return { expense: approved, accountNewBalance: updatedAccount.currentBalancePaise };
      }),
  });
}

/**
 * Section 6.3.3 — editing, permitted ONLY while pending. No Transaction
 * exists and no balance has moved, so there is nothing posted to contradict
 * and nothing to unwind; the row is simply corrected before it becomes
 * money. An approved expense is immutable and corrects via reversal.
 *
 * The `status: "pending"` check lives in the UPDATE's filter as well as the
 * read below, so an expense approved between this form loading and
 * submitting fails cleanly instead of rewriting a posted row.
 */
export async function updatePendingExpense(input: UpdatePendingExpenseInput, actor: AuthedUser) {
  const before = await findExpenseById(input.expenseId);
  if (!before) throw new AppError("NOT_FOUND", "Expense not found");
  if (before.status !== "pending") {
    throw new AppError(
      "CONFLICT",
      "Only a pending expense can be edited. Approved expenses must be reversed instead."
    );
  }

  const account = await findAccountById(input.accountId);
  if (!account || account.status !== "active") {
    throw new AppError("VALIDATION", "Selected account is not active");
  }

  const updated = await updatePendingExpenseOptimistic(input.expenseId, input.version, {
    amountPaise: input.amountPaise,
    reason: input.reason,
    paidToEntity: input.paidToEntity,
    category: input.category,
    accountId: new Types.ObjectId(input.accountId),
    spentAt: input.spentAt,
    note: input.note ?? null,
    attachments: stampAttachments(input.attachments, actor.id),
  });
  if (!updated) {
    throw new AppError(
      "CONFLICT",
      "This expense changed while you were editing it. Reopen and try again."
    );
  }

  await logAudit({
    actorUserId: actor.id,
    actorName: actor.name,
    action: "EXPENSE_UPDATED",
    entity: { kind: "expense", id: updated._id },
    before: {
      amountPaise: before.amountPaise,
      paidToEntity: before.paidToEntity,
      category: before.category,
    },
    after: {
      amountPaise: updated.amountPaise,
      paidToEntity: updated.paidToEntity,
      category: updated.category,
    },
    summary: `${actor.name} edited the pending expense to ${updated.paidToEntity} (${formatINR(before.amountPaise)} → ${formatINR(updated.amountPaise)})`,
  });

  return { expense: updated };
}

/** Dismiss a pending expense. No money moved, so there is nothing to
 * reverse — the row is kept in `cancelled` rather than deleted so a missing
 * month stays explainable a year later. */
export async function cancelPendingExpense(input: CancelPendingExpenseInput, actor: AuthedUser) {
  const before = await findExpenseById(input.expenseId);
  if (!before) throw new AppError("NOT_FOUND", "Expense not found");
  if (before.status !== "pending") {
    throw new AppError("CONFLICT", "Only a pending expense can be cancelled.");
  }

  const cancelled = await markPendingExpenseCancelled(input.expenseId, actor.id, input.reason);
  if (!cancelled) {
    throw new AppError("CONFLICT", "This expense changed while you were cancelling it.");
  }

  await logAudit({
    actorUserId: actor.id,
    actorName: actor.name,
    action: "EXPENSE_CANCELLED",
    entity: { kind: "expense", id: cancelled._id },
    before: { status: "pending" },
    after: { status: "cancelled", reason: input.reason },
    summary: `${actor.name} cancelled the pending ${formatINR(before.amountPaise)} expense to ${before.paidToEntity} (${input.reason})`,
  });

  return { expense: cancelled };
}

// Section 6.3's reversal — mirrors reversePayment (Section 6.2). Role:
// admin+ (enforced by the action wrapper, not here).
export async function reverseExpense(input: ReverseExpenseInput, actor: AuthedUser) {
  return runWithIdempotency({
    fetchExisting: async () => {
      const expense = await findExpenseById(input.expenseId);
      if (!expense || expense.status !== "reversed") return null;
      const account = await findAccountById(expense.accountId.toString());
      return { expense, accountNewBalance: account?.currentBalancePaise ?? 0 };
    },
    run: () =>
      withDbTransaction(async (session) => {
        const expense = await findExpenseById(input.expenseId);
        if (!expense) throw new AppError("NOT_FOUND", "Expense not found");
        if (expense.status !== "active") {
          throw new AppError(
            "CONFLICT",
            expense.status === "pending"
              ? "This expense has not been approved yet — cancel it instead of reversing."
              : "Already reversed. Record a fresh entry instead."
          );
        }
        // Only pending expenses carry a null transactionId, and the check
        // above has already excluded those. Reaching this is a data-integrity
        // bug (an active expense with no ledger entry), not a user error.
        if (!expense.transactionId) {
          throw new AppError("INTERNAL", "This expense has no ledger transaction to reverse.");
        }
        const originalTransactionId = expense.transactionId.toString();

        // Section 14 edge case 3's monthKey rule applies here too: the
        // reversal must land in the SAME monthKey as the original expense
        // (derived from spentAt, since Expense has no stored monthKey of
        // its own) so the monthKey-based per-account aggregates
        // (financial-engine.ts#getMonthOverview) stay balanced within
        // that month instead of drifting across two.
        const reversalTx = await insertTransaction(
          {
            type: "REVERSAL",
            direction: "IN",
            amountPaise: expense.amountPaise,
            accountId: expense.accountId.toString(),
            occurredAt: new Date(),
            monthKey: toMonthKey(expense.spentAt),
            expenseId: expense._id.toString(),
            reversesTransactionId: originalTransactionId,
            counterpartyLabel: null,
            idempotencyKey: input.idempotencyKey,
            createdBy: actor.id,
          },
          session
        );
        void reversalTx;

        await markTransactionReversed(originalTransactionId, session);
        await markExpenseReversed(expense._id.toString(), actor.id, input.reason, session);

        const updatedAccount = await incrementAccountBalance(
          expense.accountId.toString(),
          expense.amountPaise,
          session
        );
        if (!updatedAccount) throw new AppError("VALIDATION", "Account is not active");

        await logAudit(
          {
            actorUserId: actor.id,
            actorName: actor.name,
            action: "EXPENSE_REVERSED",
            entity: { kind: "expense", id: expense._id },
            before: { status: expense.status },
            after: { status: "reversed" },
            summary: `${actor.name} reversed expense to ${expense.paidToEntity} (${input.reason})`,
          },
          session
        );

        return {
          expense: { ...expense, status: "reversed" as const, reversedReason: input.reason },
          accountNewBalance: updatedAccount.currentBalancePaise,
        };
      }),
  });
}
