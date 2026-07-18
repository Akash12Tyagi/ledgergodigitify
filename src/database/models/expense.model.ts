import mongoose, { Schema, type InferSchemaType } from "mongoose";

import { ACTIVE_REVERSED_STATUSES, EXPENSE_CATEGORIES } from "@/constants/domain";
import { attachmentMetaSchema } from "@/database/models/attachment-meta.schema";
import { MAX_ATTACHMENTS_PER_ENTITY } from "@/constants/finance";

// Section 5.7 — expenses.
const expenseSchema = new Schema(
  {
    amountPaise: { type: Number, required: true, min: 1 },
    reason: { type: String, required: true, minlength: 2, maxlength: 200 },
    paidToEntity: { type: String, required: true, minlength: 2, maxlength: 120 },
    category: { type: String, enum: EXPENSE_CATEGORIES, required: true },
    accountId: { type: Schema.Types.ObjectId, ref: "Account", required: true },
    spentAt: { type: Date, required: true },
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
    // Owner-only flag (Section 6.3.2) — audited whenever true.
    overrideNegativeBalance: { type: Boolean, default: false },
    idempotencyKey: { type: String, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true, collection: "expenses" }
);

expenseSchema.index({ spentAt: -1 });
expenseSchema.index({ category: 1, spentAt: -1 });
expenseSchema.index({ accountId: 1, spentAt: -1 });
expenseSchema.index({ idempotencyKey: 1 }, { unique: true });

export type ExpenseDoc = InferSchemaType<typeof expenseSchema>;

export const ExpenseModel =
  (mongoose.models.Expense as mongoose.Model<ExpenseDoc>) ??
  mongoose.model<ExpenseDoc>("Expense", expenseSchema);
