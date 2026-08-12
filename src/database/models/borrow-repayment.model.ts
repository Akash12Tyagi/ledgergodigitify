import { Schema, type InferSchemaType } from "mongoose";
import { registerModel } from "@/database/models/register-model";

import { ACTIVE_REVERSED_STATUSES, PAYMENT_METHODS } from "@/constants/domain";

/**
 * Section 6.9 — one instalment of a Borrowing coming back.
 *
 * This is the "haan, itna paisa aa gaya" record: each repayment is its own
 * append-only row rather than an edit to the borrowing's `repaidPaise`, so
 * "he paid me ₹2,000 three times" stays visible as three events with three
 * dates. The parent's running total is incremented in the same DB
 * transaction, which is what keeps the two consistent.
 *
 * The account credited need not be the one the money was lent from — cash
 * lent from the till can perfectly well come back into the bank.
 */
const borrowRepaymentSchema = new Schema(
  {
    borrowingId: { type: Schema.Types.ObjectId, ref: "Borrowing", required: true },
    amountPaise: { type: Number, required: true, min: 1 },
    receivedAt: { type: Date, required: true },
    accountId: { type: Schema.Types.ObjectId, ref: "Account", required: true },
    method: { type: String, enum: PAYMENT_METHODS, default: "cash" },
    note: { type: String, default: null, maxlength: 500 },

    /** The LOAN_REPAY_IN transaction this repayment produced. */
    transactionId: { type: Schema.Types.ObjectId, ref: "Transaction", required: true },
    status: { type: String, enum: ACTIVE_REVERSED_STATUSES, default: "active" },
    reversedBy: { type: Schema.Types.ObjectId, ref: "Transaction", default: null },
    reversedReason: { type: String, default: null, maxlength: 200 },

    idempotencyKey: { type: String, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true, collection: "borrowrepayments" }
);

borrowRepaymentSchema.index({ borrowingId: 1, receivedAt: -1 });
borrowRepaymentSchema.index({ idempotencyKey: 1 }, { unique: true });

export type BorrowRepaymentDoc = InferSchemaType<typeof borrowRepaymentSchema>;

export const BorrowRepaymentModel = registerModel<BorrowRepaymentDoc>(
  "BorrowRepayment",
  borrowRepaymentSchema
);
