import { z } from "zod";

import { PAYMENT_METHODS } from "@/constants/domain";
import { MAX_ENTRY_PAISE } from "@/constants/finance";
import { attachmentsInputSchema, noteInputSchema, objectIdString } from "@/schemas/common.schema";

/**
 * Section 6.9 — lend money out.
 *
 * `overrideNegativeBalance` mirrors createExpense: only honoured when the
 * actor is the owner, silently ignored otherwise (never a validation error).
 * Lending you cannot fund is the same mistake as spending you cannot fund.
 */
export const createBorrowingSchema = z.strictObject({
  borrowerName: z.string().min(2).max(120),
  borrowerPhone: z
    .string()
    .regex(/^\+?\d{7,15}$/, "Invalid phone number")
    .nullable()
    .optional(),
  principalPaise: z.number().int().positive().max(MAX_ENTRY_PAISE),
  lentAt: z.date(),
  accountId: objectIdString,
  reason: z.string().max(200).nullable().optional(),
  note: noteInputSchema,
  expectedBackBy: z.date().nullable().optional(),
  attachments: attachmentsInputSchema,
  overrideNegativeBalance: z.boolean().optional(),
  idempotencyKey: z.string().min(1),
});
export type CreateBorrowingInput = z.infer<typeof createBorrowingSchema>;

/**
 * Record money coming back. The service caps this at what is still
 * outstanding — you cannot be repaid more than you lent, and accepting an
 * overpayment here would silently turn a loan into income nobody recorded.
 */
export const recordRepaymentSchema = z.strictObject({
  borrowingId: objectIdString,
  amountPaise: z.number().int().positive().max(MAX_ENTRY_PAISE),
  receivedAt: z.date(),
  accountId: objectIdString,
  method: z.enum(PAYMENT_METHODS).optional(),
  note: noteInputSchema,
  idempotencyKey: z.string().min(1),
});
export type RecordRepaymentInput = z.infer<typeof recordRepaymentSchema>;

/**
 * Give up on the outstanding balance. Moves NO money — the cash left when it
 * was lent; this only stops the remainder counting as recoverable. That is
 * why there is no account or amount here.
 */
export const writeOffBorrowingSchema = z.strictObject({
  borrowingId: objectIdString,
  reason: z.string().min(5).max(200),
});
export type WriteOffBorrowingInput = z.infer<typeof writeOffBorrowingSchema>;
