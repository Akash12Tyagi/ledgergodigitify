import { Schema, type InferSchemaType } from "mongoose";
import { registerModel } from "@/database/models/register-model";

import { EXPENSE_CATEGORIES, EXPENSE_TEMPLATE_STATUSES } from "@/constants/domain";

/**
 * Section 6.3.4 — the definition of a RECURRING expense (rent, salary, a
 * software subscription). A template is not money; it never touches an
 * account balance and never appears in the ledger. It only says "raise this
 * expense again every period", and the daily rollover turns it into a
 * PENDING Expense when each period starts.
 *
 * The period machinery is deliberately the same one clients are billed on
 * (lib/billing-period.ts): a cycle is anchored on a day-of-month and repeats
 * monthly, so a template can run 1st-to-1st or 7th-to-7th just like a
 * retainer. Reusing it means the anchor-clamping bug it already solves (an
 * anchorDay of 31 must return to 31 Mar after landing on 28 Feb, not walk
 * backwards forever) is solved here too, for free.
 *
 * `billingDay` is stored rather than re-derived from the last generated
 * period for exactly that reason — see billing-period.ts's header.
 */
const expenseTemplateSchema = new Schema(
  {
    amountPaise: { type: Number, required: true, min: 1 },
    reason: { type: String, required: true, minlength: 2, maxlength: 200 },
    paidToEntity: { type: String, required: true, minlength: 2, maxlength: 120 },
    category: { type: String, enum: EXPENSE_CATEGORIES, required: true },
    accountId: { type: Schema.Types.ObjectId, ref: "Account", required: true },

    /** First period's start. Every later period is advanced from the last
     * expense this template actually raised, never from today's calendar —
     * the same rule that stopped rollover back-billing new clients. */
    startDate: { type: Date, required: true },
    /** Day-of-month the cycle repeats on. Defaulted from `startDate` by the
     * service layer on create, never here. */
    billingDay: { type: Number, min: 1, max: 31, required: true },

    /**
     * The earliest period this template may still raise. Equals `startDate`
     * at creation and is pushed forward to "now" on RESUME.
     *
     * Without it, resuming would backfill the pause: rollover advances from
     * the last period actually raised, so a template paused for three months
     * would, on its next run, dutifully raise all three — the exact periods
     * someone paused it to avoid. This is the marker that makes a deliberate
     * gap stay a gap, while still letting a genuinely missed cron catch up.
     */
    generateFrom: { type: Date, required: true },

    status: { type: String, enum: EXPENSE_TEMPLATE_STATUSES, default: "active" },
    pausedAt: { type: Date, default: null },
    pausedReason: { type: String, default: null, maxlength: 200 },

    note: { type: String, default: null, maxlength: 500 },
    version: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true, collection: "expensetemplates" }
);

// The rollover scan: every active template, cheapest possible filter.
expenseTemplateSchema.index({ status: 1 });
expenseTemplateSchema.index({ accountId: 1, status: 1 });
expenseTemplateSchema.index({ category: 1, status: 1 });

export type ExpenseTemplateDoc = InferSchemaType<typeof expenseTemplateSchema>;

export const ExpenseTemplateModel = registerModel<ExpenseTemplateDoc>(
  "ExpenseTemplate",
  expenseTemplateSchema
);
