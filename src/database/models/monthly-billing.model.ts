import { Schema, type InferSchemaType } from "mongoose";
import { registerModel } from "@/database/models/register-model";

import { BILLING_GENERATED_BY, PAY_STATUSES } from "@/constants/domain";

/**
 * One document per client per BILLING PERIOD — a "due".
 *
 * A period is not necessarily a calendar month: clients may run 1st-to-1st,
 * 20th-to-20th or 7th-to-7th, so `periodStart`/`periodEnd` (see
 * lib/billing-period.ts) are the real identity of a due. `periodEnd` is
 * exclusive, so consecutive periods are contiguous with no shared day.
 *
 * `monthKey` survives as the REPORTING bucket only — which month the
 * month-scoped Ledger views (Overview "Billed", Dashboard cards) count this
 * due in. It is derived from `dueDate` and is deliberately NOT unique per
 * client any more: a 20th-to-20th cycle, or a manually added one-off charge
 * alongside a retainer, can legitimately put two dues in the same reporting
 * month. The uniqueness that actually matters — never billing the same
 * period twice — is enforced on {clientId, periodStart}.
 *
 * `carriedInPaise`/`carriedOutPaise` are LEGACY. Dues no longer carry their
 * unpaid remainder into the next period: each period's shortfall stays open
 * on that period (so a client owing three months shows three separate open
 * dues, which is what the Dues screen and every total already assume). The
 * fields remain, defaulted to 0, purely so rows written before that change
 * still evaluate correctly through deriveBillingStatus — nothing writes a
 * non-zero value to them any more.
 */
const monthlyBillingSchema = new Schema(
  {
    clientId: { type: Schema.Types.ObjectId, ref: "Client", required: true },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    monthKey: { type: String, required: true },
    billedPaise: { type: Number, required: true, min: 0 },
    carriedInPaise: { type: Number, default: 0 },
    carriedOutPaise: { type: Number, default: 0 },
    paidPaise: { type: Number, default: 0 },
    status: { type: String, enum: PAY_STATUSES, default: "PENDING" },
    dueDate: { type: Date, required: true },
    note: { type: String, default: null, maxlength: 500 },
    generatedBy: { type: String, enum: BILLING_GENERATED_BY, required: true },
    voidedAt: { type: Date, default: null },
    voidedReason: { type: String, default: null, maxlength: 200 },
    version: { type: Number, default: 0 },
  },
  { timestamps: true, collection: "monthlybillings" }
);

// The real "never bill the same period twice" guarantee, and the index the
// rollover's "latest period for this client" lookup sorts on.
monthlyBillingSchema.index({ clientId: 1, periodStart: 1 }, { unique: true });

// Reporting-month reads: sumBilledForMonth / findBillingsByMonth.
monthlyBillingSchema.index({ monthKey: 1, status: 1 });

// status LEADS, not dueDate: findBillingsByStatus (getDuesList / the
// outstanding scan / the due-reminder cron) filters ONLY on status and
// buckets by dueDate afterward in application code. A {dueDate:1,status:1}
// index can't serve a status-only filter — compound indexes require a
// matching prefix — and was silently COLLSCANning.
monthlyBillingSchema.index({ status: 1, dueDate: 1 });

export type MonthlyBillingDoc = InferSchemaType<typeof monthlyBillingSchema>;

export const MonthlyBillingModel = registerModel<MonthlyBillingDoc>("MonthlyBilling", monthlyBillingSchema);
