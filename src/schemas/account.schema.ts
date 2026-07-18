import { z } from "zod";

import { ACCOUNT_TYPES } from "@/constants/domain";
import { MAX_ENTRY_PAISE } from "@/constants/finance";
import { objectIdString } from "@/schemas/common.schema";

// Section 6.9 — createAccount / updateAccount.
export const createAccountSchema = z.strictObject({
  name: z.string().min(2).max(80),
  type: z.enum(ACCOUNT_TYPES),
  openingBalancePaise: z.number().int().min(0).max(MAX_ENTRY_PAISE),
  bankName: z.string().max(120).nullable().optional(),
  last4: z
    .string()
    .regex(/^\d{4}$/, "last4 must be exactly 4 digits")
    .nullable()
    .optional(),
  lowBalanceThresholdPaise: z.number().int().min(0).nullable().optional(),
  isDefault: z.boolean().optional(),
});
export type CreateAccountInput = z.infer<typeof createAccountSchema>;

export const updateAccountSchema = createAccountSchema.partial({
  name: true,
  type: true,
  openingBalancePaise: true,
}).extend({
  accountId: objectIdString,
  version: z.number().int().min(0),
});
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;

// Section 6.5 — transferBetweenAccounts. Section 14 edge case 20: transfer
// to self is a VALIDATION error, enforced here so both the form and the
// server reject it identically (Law 8). `overrideNegativeBalance` mirrors
// Section 6.3's rule for the `from` leg — owner-only, silently ignored by
// the service for anyone else.
export const transferSchema = z
  .strictObject({
    fromAccountId: objectIdString,
    toAccountId: objectIdString,
    amountPaise: z.number().int().positive().max(MAX_ENTRY_PAISE),
    note: z.string().max(500).nullable().optional(),
    occurredAt: z.date(),
    overrideNegativeBalance: z.boolean().optional(),
    idempotencyKey: z.string().min(1),
  })
  .refine((data) => data.fromAccountId !== data.toAccountId, {
    message: "Choose two different accounts.",
    path: ["toAccountId"],
  });
export type TransferInput = z.infer<typeof transferSchema>;

// Section 6.5's reversal — both legs, identified by their shared
// transactionGroupId.
export const reverseTransferSchema = z.strictObject({
  transactionGroupId: objectIdString,
  reason: z.string().min(5).max(200),
  idempotencyKey: z.string().min(1),
});
export type ReverseTransferInput = z.infer<typeof reverseTransferSchema>;
