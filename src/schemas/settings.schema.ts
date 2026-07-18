import { z } from "zod";

// Section 5.13/7.14 — /settings general form. All owner-editable
// operational thresholds and company metadata.
export const updateSettingsSchema = z.strictObject({
  companyName: z.string().min(1, "Company name is required").max(120),
  largeExpenseAlertPaise: z.number().int().min(0),
  lowBalanceDefaultPaise: z.number().int().min(0),
  dueSoonDays: z.number().int().min(0).max(60),
  financialYearStartMonth: z.number().int().min(1).max(12),
  goLiveDate: z.date().nullable().optional(),
});
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
