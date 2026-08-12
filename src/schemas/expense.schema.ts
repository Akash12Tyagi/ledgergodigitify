import { z } from "zod";

import { EXPENSE_CATEGORIES } from "@/constants/domain";
import { MAX_ENTRY_PAISE } from "@/constants/finance";
import { attachmentsInputSchema, noteInputSchema, objectIdString } from "@/schemas/common.schema";

// Section 6.3 — createExpense. `overrideNegativeBalance` is only honored
// server-side if role === owner (Section 6.3 step 2); a non-owner sending
// it is silently ignored by the service, not a validation error here.
export const createExpenseSchema = z.strictObject({
  amountPaise: z.number().int().positive().max(MAX_ENTRY_PAISE),
  reason: z.string().min(2).max(200),
  paidToEntity: z.string().min(2).max(120),
  category: z.enum(EXPENSE_CATEGORIES),
  accountId: objectIdString,
  spentAt: z.date(),
  note: noteInputSchema,
  attachments: attachmentsInputSchema,
  overrideNegativeBalance: z.boolean().optional(),
  idempotencyKey: z.string().min(1),
});
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;

export const reverseExpenseSchema = z.strictObject({
  expenseId: objectIdString,
  reason: z.string().min(5).max(200),
  idempotencyKey: z.string().min(1),
});
export type ReverseExpenseInput = z.infer<typeof reverseExpenseSchema>;

/**
 * Section 6.3.3 — approveExpense. Posts a PENDING expense: this is the
 * moment money actually leaves, so every guard createExpense applies
 * (active account, no reconcile lock, sufficient balance, no future date)
 * applies here instead — deferred from creation, because at creation there
 * was nothing to guard.
 *
 * `spentAt` is asked for again rather than reusing the pending row's date.
 * A template raises August's salary dated 1 Aug; if it is actually paid on
 * the 3rd, the LEDGER must say the 3rd, because the balance changed on the
 * 3rd. The period it covers is preserved separately on the expense.
 */
export const approveExpenseSchema = z.strictObject({
  expenseId: objectIdString,
  spentAt: z.date(),
  overrideNegativeBalance: z.boolean().optional(),
  idempotencyKey: z.string().min(1),
});
export type ApproveExpenseInput = z.infer<typeof approveExpenseSchema>;

/**
 * Editing is allowed ONLY while an expense is pending — nothing has posted,
 * so there is no ledger entry to contradict and no balance to unwind. Once
 * approved, the only correction is a reversal (Section 4.2's immutability
 * rule). The service re-checks the status; this schema cannot.
 */
export const updatePendingExpenseSchema = z.strictObject({
  expenseId: objectIdString,
  amountPaise: z.number().int().positive().max(MAX_ENTRY_PAISE),
  reason: z.string().min(2).max(200),
  paidToEntity: z.string().min(2).max(120),
  category: z.enum(EXPENSE_CATEGORIES),
  accountId: objectIdString,
  spentAt: z.date(),
  note: noteInputSchema,
  attachments: attachmentsInputSchema,
  version: z.number().int().min(0),
});
export type UpdatePendingExpenseInput = z.infer<typeof updatePendingExpenseSchema>;

/** Dismiss a pending expense (a month's rent that was never actually owed).
 * No money moved, so there is nothing to reverse — the row is kept in a
 * `cancelled` state rather than deleted so the gap stays explainable. */
export const cancelPendingExpenseSchema = z.strictObject({
  expenseId: objectIdString,
  reason: z.string().min(2).max(200),
});
export type CancelPendingExpenseInput = z.infer<typeof cancelPendingExpenseSchema>;
