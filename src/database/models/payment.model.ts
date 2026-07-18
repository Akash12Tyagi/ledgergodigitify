import mongoose, { Schema, type InferSchemaType } from "mongoose";

import { ACTIVE_REVERSED_STATUSES, PAYMENT_METHODS } from "@/constants/domain";
import { attachmentMetaSchema } from "@/database/models/attachment-meta.schema";
import { MAX_ATTACHMENTS_PER_ENTITY } from "@/constants/finance";

// Section 5.4 — payments. Immutable (Law 3): corrections are reversals,
// never edits. monthKey follows the BILLING it settles, not `paidAt`
// (Section 14 edge case 3).
const paymentSchema = new Schema(
  {
    clientId: { type: Schema.Types.ObjectId, ref: "Client", required: true },
    monthlyBillingId: { type: Schema.Types.ObjectId, ref: "MonthlyBilling", required: true },
    accountId: { type: Schema.Types.ObjectId, ref: "Account", required: true },
    amountPaise: { type: Number, required: true, min: 1 },
    paidAt: { type: Date, required: true },
    monthKey: { type: String, required: true },
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    invoiceNumber: { type: String, required: true },
    receiptNumber: { type: String, required: true },
    reference: { type: String, default: null, maxlength: 120 },
    note: { type: String, default: null, maxlength: 500 },
    attachments: {
      type: [attachmentMetaSchema],
      default: [],
      validate: {
        validator: (arr: unknown[]) => arr.length <= MAX_ATTACHMENTS_PER_ENTITY,
        message: `At most ${MAX_ATTACHMENTS_PER_ENTITY} attachments allowed`,
      },
    },
    transactionId: { type: Schema.Types.ObjectId, ref: "Transaction", required: true },
    status: { type: String, enum: ACTIVE_REVERSED_STATUSES, default: "active" },
    reversedBy: { type: Schema.Types.ObjectId, ref: "Transaction", default: null },
    reversedReason: { type: String, default: null },
    idempotencyKey: { type: String, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true, collection: "payments" }
);

paymentSchema.index({ clientId: 1, paidAt: -1 });
paymentSchema.index({ accountId: 1, paidAt: -1 });
paymentSchema.index({ monthKey: 1, status: 1 });
paymentSchema.index({ invoiceNumber: 1 }, { unique: true });
paymentSchema.index({ receiptNumber: 1 }, { unique: true });
paymentSchema.index({ idempotencyKey: 1 }, { unique: true });

export type PaymentDoc = InferSchemaType<typeof paymentSchema>;

export const PaymentModel =
  (mongoose.models.Payment as mongoose.Model<PaymentDoc>) ??
  mongoose.model<PaymentDoc>("Payment", paymentSchema);
