import { Types } from "mongoose";

import { AppError } from "@/lib/errors";
import { withDbTransaction } from "@/lib/db-transaction";
import { runWithIdempotency } from "@/lib/idempotency";
import { isAfterTodayIST, toMonthKey, todayIST } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import { stampAttachments } from "@/lib/attachments";
import {
  findAccountById,
  findAccountsByIds,
  incrementAccountBalance,
} from "@/server/repositories/accounts.repository";
import {
  findExpenseByIdempotencyKey,
  findExpenseById,
  findExpensesPaginated,
  insertExpense,
  markExpenseReversed,
  type ExpenseListFilter,
} from "@/server/repositories/expenses.repository";

export type { ExpenseListFilter };
import { insertTransaction, markTransactionReversed } from "@/server/repositories/transactions.repository";
import { getSettingsOrDefaults } from "@/server/repositories/settings.repository";
import { logAudit } from "@/server/services/audit.service";
import { notify } from "@/server/services/notifications.service";
import type { AuthedUser } from "@/server/auth/guards";
import type { CreateExpenseInput, ReverseExpenseInput } from "@/schemas/expense.schema";
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
    status: r.status as "active" | "reversed",
    reversedReason: r.reversedReason ?? null,
    overrideNegativeBalance: r.overrideNegativeBalance,
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
          throw new AppError("CONFLICT", "Already reversed. Record a fresh entry instead.");
        }

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
            reversesTransactionId: expense.transactionId.toString(),
            counterpartyLabel: null,
            idempotencyKey: input.idempotencyKey,
            createdBy: actor.id,
          },
          session
        );
        void reversalTx;

        await markTransactionReversed(expense.transactionId.toString(), session);
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
