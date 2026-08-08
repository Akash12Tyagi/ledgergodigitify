import { Schema, Types } from "mongoose";
import { registerModel } from "@/database/models/register-model";

import {
  DUE_SOON_DAYS_DEFAULT,
  LARGE_EXPENSE_ALERT_PAISE_DEFAULT,
  LOW_BALANCE_DEFAULT_PAISE_DEFAULT,
} from "@/constants/finance";

// Section 5.13 — single document, _id:"global". Owner-editable operational
// thresholds and company metadata. Typed explicitly (rather than via
// InferSchemaType) because overriding `_id` to a string confuses
// Mongoose's default-ObjectId-`_id` type inference.
export interface SettingsDoc {
  _id: string;
  largeExpenseAlertPaise: number;
  lowBalanceDefaultPaise: number;
  dueSoonDays: number;
  companyName: string;
  financialYearStartMonth: number;
  goLiveDate: Date | null;
  updatedBy: Types.ObjectId;
  version: number;
}

const settingsSchema = new Schema<SettingsDoc>(
  {
    _id: { type: String, required: true, default: "global" },
    largeExpenseAlertPaise: { type: Number, required: true, default: LARGE_EXPENSE_ALERT_PAISE_DEFAULT },
    lowBalanceDefaultPaise: { type: Number, required: true, default: LOW_BALANCE_DEFAULT_PAISE_DEFAULT },
    dueSoonDays: { type: Number, required: true, default: DUE_SOON_DAYS_DEFAULT },
    companyName: { type: String, required: true },
    financialYearStartMonth: { type: Number, min: 1, max: 12, default: 4 },
    goLiveDate: { type: Date, default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    version: { type: Number, default: 0 },
  },
  { timestamps: true, collection: "settings" }
);

export const SettingsModel = registerModel<SettingsDoc>("Settings", settingsSchema);
