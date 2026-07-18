import mongoose, { Schema, type InferSchemaType } from "mongoose";

import { ACTIVE_REVERSED_STATUSES, CREDIT_CATEGORIES } from "@/constants/domain";
import { attachmentMetaSchema } from "@/database/models/attachment-meta.schema";
import { MAX_ATTACHMENTS_PER_ENTITY } from "@/constants/finance";

// Section 5.8 — credits (non-client money in: owner capital, loans,
// refunds, etc. — kept separate from client revenue).
const creditSchema = new Schema(
  {
    amountPaise: { type: Number, required: true, min: 1 },
    source: { type: String, required: true, minlength: 2, maxlength: 120 },
    reason: { type: String, required: true, minlength: 2, maxlength: 200 },
    category: { type: String, enum: CREDIT_CATEGORIES, required: true },
    accountId: { type: Schema.Types.ObjectId, ref: "Account", required: true },
    receivedAt: { type: Date, required: true },
    attachments: {
      type: [attachmentMetaSchema],
      default: [],
      validate: {
        validator: (arr: unknown[]) => arr.length <= MAX_ATTACHMENTS_PER_ENTITY,
        message: `At most ${MAX_ATTACHMENTS_PER_ENTITY} attachments allowed`,
      },
    },
    note: { type: String, default: null, maxlength: 500 },
    transactionId: { type: Schema.Types.ObjectId, ref: "Transaction", required: true },
    status: { type: String, enum: ACTIVE_REVERSED_STATUSES, default: "active" },
    reversedBy: { type: Schema.Types.ObjectId, ref: "Transaction", default: null },
    reversedReason: { type: String, default: null },
    idempotencyKey: { type: String, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true, collection: "credits" }
);

creditSchema.index({ receivedAt: -1 });
creditSchema.index({ category: 1, receivedAt: -1 });
creditSchema.index({ idempotencyKey: 1 }, { unique: true });

export type CreditDoc = InferSchemaType<typeof creditSchema>;

export const CreditModel =
  (mongoose.models.Credit as mongoose.Model<CreditDoc>) ??
  mongoose.model<CreditDoc>("Credit", creditSchema);
