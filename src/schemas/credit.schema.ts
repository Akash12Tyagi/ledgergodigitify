import { z } from "zod";

import { CREDIT_CATEGORIES } from "@/constants/domain";
import { MAX_ENTRY_PAISE } from "@/constants/finance";
import { attachmentsInputSchema, noteInputSchema, objectIdString } from "@/schemas/common.schema";

// Section 6.4 — createCredit (mirror of expense, direction IN).
export const createCreditSchema = z.strictObject({
  amountPaise: z.number().int().positive().max(MAX_ENTRY_PAISE),
  source: z.string().min(2).max(120),
  reason: z.string().min(2).max(200),
  category: z.enum(CREDIT_CATEGORIES),
  accountId: objectIdString,
  receivedAt: z.date(),
  note: noteInputSchema,
  attachments: attachmentsInputSchema,
  idempotencyKey: z.string().min(1),
});
export type CreateCreditInput = z.infer<typeof createCreditSchema>;

export const reverseCreditSchema = z.strictObject({
  creditId: objectIdString,
  reason: z.string().min(5).max(200),
  idempotencyKey: z.string().min(1),
});
export type ReverseCreditInput = z.infer<typeof reverseCreditSchema>;
