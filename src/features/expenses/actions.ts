"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/auth/guards";
import { checkRateLimit } from "@/lib/rate-limit";
import { parseActionInput } from "@/lib/validate-action";
import { runAction, type ApiResult } from "@/lib/result";
import {
  approveExpenseSchema,
  cancelPendingExpenseSchema,
  createExpenseSchema,
  reverseExpenseSchema,
  updatePendingExpenseSchema,
} from "@/schemas/expense.schema";
import * as expensesService from "@/server/services/expenses.service";
import type { ExpenseListFilter } from "@/server/services/expenses.service";

function revalidateExpensePaths() {
  revalidatePath("/ledger/expenses");
  revalidatePath("/ledger/recurring");
  revalidatePath("/ledger/overview");
  revalidatePath("/ledger/accounts");
  revalidatePath("/dashboard");
  revalidatePath("/notifications");
}

export type ExpenseResult = { expenseId: string; accountNewBalance: number };

// Section 8.2 — createExpenseAction. Section 1.2: recording expenses
// needs staff+ (same row as recordPayment).
export async function createExpenseAction(input: unknown): Promise<ApiResult<ExpenseResult>> {
  return runAction(async () => {
    await checkRateLimit("mutation", "createExpense");
    const actor = await requireUser("staff");
    const parsed = parseActionInput(createExpenseSchema, input);
    const result = await expensesService.createExpense(parsed, actor);
    revalidateExpensePaths();
    revalidatePath(`/ledger/accounts/${parsed.accountId}`);
    return { expenseId: result.expense._id.toString(), accountNewBalance: result.accountNewBalance };
  });
}

// Section 1.2: reversing transactions needs admin+.
export async function reverseExpenseAction(input: unknown): Promise<ApiResult<ExpenseResult>> {
  return runAction(async () => {
    await checkRateLimit("mutation", "reverseExpense");
    const actor = await requireUser("admin");
    const parsed = parseActionInput(reverseExpenseSchema, input);
    const result = await expensesService.reverseExpense(parsed, actor);
    revalidateExpensePaths();
    revalidatePath(`/ledger/accounts/${result.expense.accountId.toString()}`);
    return { expenseId: result.expense._id.toString(), accountNewBalance: result.accountNewBalance };
  });
}

/**
 * Role: admin+, the same bar as reversing. Approving is the step that
 * actually releases money someone (or the cron) scheduled earlier, so it
 * sits above recording a one-off expense you already paid.
 */
export async function approveExpenseAction(input: unknown): Promise<ApiResult<ExpenseResult>> {
  return runAction(async () => {
    await checkRateLimit("mutation", "approveExpense");
    const actor = await requireUser("admin");
    const parsed = parseActionInput(approveExpenseSchema, input);
    const result = await expensesService.approveExpense(parsed, actor);
    revalidateExpensePaths();
    revalidatePath(`/ledger/accounts/${result.expense.accountId.toString()}`);
    return {
      expenseId: result.expense._id.toString(),
      accountNewBalance: result.accountNewBalance,
    };
  });
}

/** Role: staff+ — the same bar as creating one. Editing a pending row moves
 * no money; the money decision is the approval, which is gated harder. */
export async function updatePendingExpenseAction(
  input: unknown
): Promise<ApiResult<{ expenseId: string }>> {
  return runAction(async () => {
    await checkRateLimit("mutation", "updatePendingExpense");
    const actor = await requireUser("staff");
    const parsed = parseActionInput(updatePendingExpenseSchema, input);
    const result = await expensesService.updatePendingExpense(parsed, actor);
    revalidateExpensePaths();
    return { expenseId: result.expense._id.toString() };
  });
}

/** Role: admin+ — dismissing a scheduled payment is a money decision even
 * though no money moves. */
export async function cancelPendingExpenseAction(
  input: unknown
): Promise<ApiResult<{ expenseId: string }>> {
  return runAction(async () => {
    await checkRateLimit("mutation", "cancelPendingExpense");
    const actor = await requireUser("admin");
    const parsed = parseActionInput(cancelPendingExpenseSchema, input);
    const result = await expensesService.cancelPendingExpense(parsed, actor);
    revalidateExpensePaths();
    return { expenseId: result.expense._id.toString() };
  });
}

export async function listExpensesAction(
  filter: ExpenseListFilter
): Promise<ApiResult<Awaited<ReturnType<typeof expensesService.listExpenses>>>> {
  return runAction(async () => {
    await requireUser("viewer");
    return expensesService.listExpenses(filter);
  });
}
