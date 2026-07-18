import mongoose, { Schema, type InferSchemaType } from "mongoose";

import { BILLING_GENERATED_BY, PAY_STATUSES } from "@/constants/domain";

// Section 5.3 — one document per client per month. `carriedOutPaise` is
// added per Section 6.8A's carry-as-a-MOVE implementation: when a rollover
// carries an unpaid remainder into the next month's billing, the SOURCE
// month records how much it gave away here, so
// remaining = max(0, billed + carriedIn - paid - carriedOut) never
// double-counts the same rupee in two months' totals.
const monthlyBillingSchema = new Schema(
  {
    clientId: { type: Schema.Types.ObjectId, ref: "Client", required: true },
    monthKey: { type: String, required: true },
    billedPaise: { type: Number, required: true, min: 0 },
    carriedInPaise: { type: Number, default: 0 },
    carriedOutPaise: { type: Number, default: 0 },
    paidPaise: { type: Number, default: 0 },
    status: { type: String, enum: PAY_STATUSES, default: "PENDING" },
    dueDate: { type: Date, required: true },
    generatedBy: { type: String, enum: BILLING_GENERATED_BY, required: true },
    version: { type: Number, default: 0 },
  },
  { timestamps: true, collection: "monthlybillings" }
);

monthlyBillingSchema.index({ clientId: 1, monthKey: 1 }, { unique: true });
monthlyBillingSchema.index({ monthKey: 1, status: 1 });
// Section 15/M8 hardening — status LEADS, not dueDate: `findBillingsByStatus`
// (getDuesList / getMonthOverview's outstanding scan / the due-reminder
// cron) filters ONLY on status, bucketing by dueDate afterward in
// application code, never in the query itself. A {dueDate:1,status:1}
// index can't serve a status-only filter (compound indexes require a
// matching prefix) and was silently COLLSCANning — caught by
// scripts/verify-indexes.ts.
monthlyBillingSchema.index({ status: 1, dueDate: 1 });

export type MonthlyBillingDoc = InferSchemaType<typeof monthlyBillingSchema>;

export const MonthlyBillingModel =
  (mongoose.models.MonthlyBilling as mongoose.Model<MonthlyBillingDoc>) ??
  mongoose.model<MonthlyBillingDoc>("MonthlyBilling", monthlyBillingSchema);
