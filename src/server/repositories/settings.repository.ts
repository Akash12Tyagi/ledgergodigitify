import { Types } from "mongoose";

import { db } from "@/database/connection";
import { SettingsModel } from "@/database/models/settings.model";
import {
  DUE_SOON_DAYS_DEFAULT,
  LARGE_EXPENSE_ALERT_PAISE_DEFAULT,
  LOW_BALANCE_DEFAULT_PAISE_DEFAULT,
} from "@/constants/finance";

/**
 * Section 5.13 — the settings document isn't created until go-live
 * (Section 17.3 step 2) or the owner first saves /settings (M7). Every
 * reader before that point must fall back to the constants/finance.ts
 * defaults rather than fail — this function is the one place that
 * fallback happens, so no caller re-implements it.
 */
export async function getSettingsOrDefaults() {
  await db();
  const doc = await SettingsModel.findById("global").lean();
  return {
    largeExpenseAlertPaise: doc?.largeExpenseAlertPaise ?? LARGE_EXPENSE_ALERT_PAISE_DEFAULT,
    lowBalanceDefaultPaise: doc?.lowBalanceDefaultPaise ?? LOW_BALANCE_DEFAULT_PAISE_DEFAULT,
    dueSoonDays: doc?.dueSoonDays ?? DUE_SOON_DAYS_DEFAULT,
    companyName: doc?.companyName ?? null,
    financialYearStartMonth: doc?.financialYearStartMonth ?? 4,
    goLiveDate: doc?.goLiveDate ?? null,
  };
}

export type UpsertSettingsInput = {
  companyName: string;
  largeExpenseAlertPaise: number;
  lowBalanceDefaultPaise: number;
  dueSoonDays: number;
  financialYearStartMonth: number;
  goLiveDate: Date | null;
  updatedBy: string;
};

/** Section 5.13/7.14 — a single global document (`_id: "global"`),
 * created on first save (Section 17.3 step 2 does this at go-live, but
 * the owner may also save /settings before then). Not optimistic-lock
 * gated like accounts/clients — settings are edited rarely, by the owner
 * only, and a lost concurrent edit here has none of the money-correctness
 * stakes that justify that ceremony elsewhere. */
export async function upsertSettings(input: UpsertSettingsInput) {
  await db();
  return SettingsModel.findOneAndUpdate(
    { _id: "global" },
    {
      $set: {
        companyName: input.companyName,
        largeExpenseAlertPaise: input.largeExpenseAlertPaise,
        lowBalanceDefaultPaise: input.lowBalanceDefaultPaise,
        dueSoonDays: input.dueSoonDays,
        financialYearStartMonth: input.financialYearStartMonth,
        goLiveDate: input.goLiveDate,
        updatedBy: new Types.ObjectId(input.updatedBy),
      },
      $inc: { version: 1 },
    },
    { upsert: true, returnDocument: "after" }
  ).lean();
}
