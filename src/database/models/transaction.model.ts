import mongoose, { Schema, type InferSchemaType } from "mongoose";

import { ACTIVE_REVERSED_STATUSES, TRANSACTION_DIRECTIONS, TRANSACTION_TYPES } from "@/constants/domain";

// Section 5.6 — THE LEDGER. Append-only; the only permitted update is the
// status flip to "reversed" (Law 3). No deletes anywhere in the codebase.
const transactionSchema = new Schema(
  {
    type: { type: String, enum: TRANSACTION_TYPES, required: true },
    direction: { type: String, enum: TRANSACTION_DIRECTIONS, required: true },
    amountPaise: { type: Number, required: true, min: 1 },
    accountId: { type: Schema.Types.ObjectId, ref: "Account", required: true },
    occurredAt: { type: Date, required: true },
    monthKey: { type: String, required: true },
    clientId: { type: Schema.Types.ObjectId, ref: "Client", default: null },
    paymentId: { type: Schema.Types.ObjectId, ref: "Payment", default: null },
    expenseId: { type: Schema.Types.ObjectId, ref: "Expense", default: null },
    creditId: { type: Schema.Types.ObjectId, ref: "Credit", default: null },
    invoiceNumber: { type: String, default: null },
    receiptNumber: { type: String, default: null },
    counterpartyLabel: { type: String, default: null },
    transactionGroupId: { type: Schema.Types.ObjectId, default: null },
    reversesTransactionId: { type: Schema.Types.ObjectId, ref: "Transaction", default: null },
    status: { type: String, enum: ACTIVE_REVERSED_STATUSES, default: "active" },
    note: { type: String, default: null, maxlength: 500 },
    idempotencyKey: { type: String, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true, collection: "transactions" }
);

transactionSchema.index({ accountId: 1, occurredAt: -1 });
transactionSchema.index({ monthKey: 1, type: 1, status: 1 });
transactionSchema.index({ clientId: 1, occurredAt: -1 });
transactionSchema.index({ transactionGroupId: 1 });
transactionSchema.index({ idempotencyKey: 1 }, { unique: true });

export type TransactionDoc = InferSchemaType<typeof transactionSchema>;

export const TransactionModel =
  (mongoose.models.Transaction as mongoose.Model<TransactionDoc>) ??
  mongoose.model<TransactionDoc>("Transaction", transactionSchema);
