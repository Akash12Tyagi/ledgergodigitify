import { z } from "zod";

import { PAYMENT_METHODS } from "@/constants/domain";
import { MAX_ENTRY_PAISE } from "@/constants/finance";
import { attachmentsInputSchema, noteInputSchema, objectIdString } from "@/schemas/common.schema";

// Section 6.1 — recordPayment input. `paidAt` future-date rejection and
// `LARGE_ENTRY_CONFIRM_PAISE` are UX-layer concerns (Section 7.4/14.10),
// not schema-level rejections — only MAX_ENTRY_PAISE is a hard reject here.
//
// invoiceNumber/receiptNumber are manually entered by the user (no more
// counter-based auto-generation — see server/services/payments.service.ts);
// `.trim()` runs before `.min(1)` so whitespace-only input is rejected as
// empty, and the trimmed value is what's persisted/checked for uniqueness.
export const recordPaymentSchema = z.strictObject({
  clientId: objectIdString,
  monthlyBillingId: objectIdString,
  amountPaise: z.number().int().positive().max(MAX_ENTRY_PAISE),
  accountId: objectIdString,
  paidAt: z.date(),
  method: z.enum(PAYMENT_METHODS),
  invoiceNumber: z.string().trim().min(1, "Invoice number is required").max(60),
  receiptNumber: z.string().trim().min(1, "Receipt number is required").max(60),
  reference: z.string().max(120).nullable().optional(),
  note: noteInputSchema,
  attachments: attachmentsInputSchema,
  idempotencyKey: z.string().min(1),
});
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

// Section 6.2 — reversePayment. TypedConfirm on the client types "REVERSE"
// (Section 12); the server only needs the paymentId, reason, and key.
export const reversePaymentSchema = z.strictObject({
  paymentId: objectIdString,
  reason: z.string().min(5).max(200),
  idempotencyKey: z.string().min(1),
});
export type ReversePaymentInput = z.infer<typeof reversePaymentSchema>;
