import { Schema, type InferSchemaType } from "mongoose";
import { registerModel } from "@/database/models/register-model";

import { BORROWING_STATUSES } from "@/constants/domain";
import { attachmentMetaSchema } from "@/database/models/attachment-meta.schema";
import { MAX_ATTACHMENTS_PER_ENTITY } from "@/constants/finance";

/**
 * Section 6.9 — money LENT OUT to a person, and what is still owed back.
 *
 * Direction matters and the name does not carry it: this is "udhaar diya",
 * cash that left this business. Money borrowed FROM someone is not modelled
 * here — that arrives as a Credit with category "loan".
 *
 * A borrowing is not an expense. Lending ₹10,000 does not make the business
 * ₹10,000 poorer, it converts ₹10,000 of cash into ₹10,000 of receivable, so
 * it is deliberately kept out of expense totals and the category chart. The
 * ledger side is a LOAN_OUT transaction; repayments come back as
 * LOAN_REPAY_IN (see TRANSACTION_TYPES).
 *
 * `repaidPaise` is materialised rather than summed from repayments on every
 * read, the same trade-off MonthlyBilling makes with `paidPaise`: it is
 * incremented in the same DB transaction that inserts the repayment, so the
 * two can never drift.
 */
const borrowingSchema = new Schema(
  {
    borrowerName: { type: String, required: true, minlength: 2, maxlength: 120 },
    borrowerPhone: { type: String, default: null, maxlength: 20 },
    principalPaise: { type: Number, required: true, min: 1 },
    repaidPaise: { type: Number, default: 0, min: 0 },
    lentAt: { type: Date, required: true },
    /** The account the cash left from. */
    accountId: { type: Schema.Types.ObjectId, ref: "Account", required: true },
    reason: { type: String, default: null, maxlength: 200 },
    note: { type: String, default: null, maxlength: 500 },
    /** Optional agreed-by date. Purely informational — nothing auto-chases. */
    expectedBackBy: { type: Date, default: null },
    attachments: {
      type: [attachmentMetaSchema],
      default: [],
      validate: {
        validator: (arr: unknown[]) => arr.length <= MAX_ATTACHMENTS_PER_ENTITY,
        message: `At most ${MAX_ATTACHMENTS_PER_ENTITY} attachments allowed`,
      },
    },

    status: { type: String, enum: BORROWING_STATUSES, default: "open" },
    /** The LOAN_OUT transaction that moved the cash. */
    transactionId: { type: Schema.Types.ObjectId, ref: "Transaction", required: true },

    writtenOffAt: { type: Date, default: null },
    writtenOffBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    writtenOffReason: { type: String, default: null, maxlength: 200 },

    idempotencyKey: { type: String, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    version: { type: Number, default: 0 },
  },
  { timestamps: true, collection: "borrowings" }
);

// The default list: who still owes money, oldest first.
borrowingSchema.index({ status: 1, lentAt: -1 });
borrowingSchema.index({ borrowerName: "text" });
borrowingSchema.index({ accountId: 1, lentAt: -1 });
borrowingSchema.index({ idempotencyKey: 1 }, { unique: true });

export type BorrowingDoc = InferSchemaType<typeof borrowingSchema>;

export const BorrowingModel = registerModel<BorrowingDoc>("Borrowing", borrowingSchema);
