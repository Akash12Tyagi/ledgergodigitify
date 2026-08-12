import { Schema, type InferSchemaType } from "mongoose";
import { registerModel } from "@/database/models/register-model";

import { EXPENSE_CATEGORIES, EXPENSE_GENERATED_BY, EXPENSE_STATUSES } from "@/constants/domain";
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

    /**
     * NULL while `status: "pending"` — a pending expense has not moved any
     * money, so no ledger Transaction exists for it yet. It is populated by
     * approveExpense, in the same DB transaction that posts the money.
     *
     * Every read that sums or reconciles the ledger already filters on
     * `status: "active"`, so a null here is never reachable from the money
     * math; treat a null on a non-pending expense as a bug, not a case to
     * handle.
     */
    transactionId: { type: Schema.Types.ObjectId, ref: "Transaction", default: null },
    status: { type: String, enum: EXPENSE_STATUSES, default: "active" },
    reversedBy: { type: Schema.Types.ObjectId, ref: "Transaction", default: null },
    reversedReason: { type: String, default: null },

    // --- Recurring / approval (Section 6.3.3–6.3.4) ---

    /** Set when the daily rollover raised this from an ExpenseTemplate.
     * Null for one-off expenses typed in by hand. */
    templateId: { type: Schema.Types.ObjectId, ref: "ExpenseTemplate", default: null },
    generatedBy: { type: String, enum: EXPENSE_GENERATED_BY, default: "manual" },

    /**
     * The billing period this expense covers — e.g. August's salary. Only
     * set on template-generated rows, and deliberately separate from
     * `spentAt` (when the money actually left): August's salary paid on
     * 3 Sep belongs to the August PERIOD but the September LEDGER, because
     * this ledger is cash-based. Keeping both means neither question has to
     * be answered by guessing.
     */
    periodStart: { type: Date, default: null },
    periodEnd: { type: Date, default: null },

    approvedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    approvedAt: { type: Date, default: null },
    cancelledBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    cancelledAt: { type: Date, default: null },
    cancelledReason: { type: String, default: null, maxlength: 200 },
    /** Bumped on every edit of a pending row, so a stale form cannot
     * overwrite a newer one (same optimistic-locking rule as Client). */
    version: { type: Number, default: 0 },
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

// The approvals queue: status LEADS because that list filters on status
// alone and orders within it.
expenseSchema.index({ status: 1, spentAt: -1 });

/**
 * "Never raise the same period twice for one template" — the expense-side
 * equivalent of MonthlyBilling's {clientId, periodStart} guarantee, and what
 * makes the rollover safe to run concurrently or five times in a row.
 *
 * PARTIAL, because most expenses are one-offs with templateId null: a plain
 * unique index would read every one of those as the same (null, null) key
 * and reject the second manual expense ever recorded.
 */
expenseSchema.index(
  { templateId: 1, periodStart: 1 },
  { unique: true, partialFilterExpression: { templateId: { $type: "objectId" } } }
);

export type ExpenseDoc = InferSchemaType<typeof expenseSchema>;

export const ExpenseModel = registerModel<ExpenseDoc>("Expense", expenseSchema);
