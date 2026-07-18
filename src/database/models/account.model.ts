import mongoose, { Schema, type InferSchemaType } from "mongoose";

import { ACCOUNT_STATUSES, ACCOUNT_TYPES } from "@/constants/domain";

// Section 5.5 — accounts (bank/cash/UPI ledger accounts). Name is unique
// only AMONG active accounts (a partial index) — an archived account's old
// name can be reused by a new account.
const accountSchema = new Schema(
  {
    name: { type: String, required: true, minlength: 2, maxlength: 80 },
    type: { type: String, enum: ACCOUNT_TYPES, required: true },
    openingBalancePaise: { type: Number, required: true, min: 0 },
    currentBalancePaise: { type: Number, required: true, default: 0 },
    bankName: { type: String, default: null },
    last4: {
      type: String,
      default: null,
      validate: {
        validator: (v: string | null) => v === null || /^\d{4}$/.test(v),
        message: "last4 must be exactly 4 digits",
      },
    },
    isDefault: { type: Boolean, default: false },
    lowBalanceThresholdPaise: { type: Number, default: null },
    reconcileLock: { type: Boolean, default: false },
    status: { type: String, enum: ACCOUNT_STATUSES, default: "active" },
    archivedAt: { type: Date, default: null },
    version: { type: Number, default: 0 },
  },
  { timestamps: true, collection: "accounts" }
);

accountSchema.index({ status: 1, name: 1 });
accountSchema.index(
  { name: 1 },
  { unique: true, partialFilterExpression: { status: "active" } }
);

export type AccountDoc = InferSchemaType<typeof accountSchema>;

export const AccountModel =
  (mongoose.models.Account as mongoose.Model<AccountDoc>) ??
  mongoose.model<AccountDoc>("Account", accountSchema);
