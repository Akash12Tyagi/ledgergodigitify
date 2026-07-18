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
