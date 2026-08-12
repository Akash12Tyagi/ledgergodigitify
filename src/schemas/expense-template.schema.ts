import { z } from "zod";

import { EXPENSE_CATEGORIES } from "@/constants/domain";
import { MAX_ENTRY_PAISE } from "@/constants/finance";
import { noteInputSchema, objectIdString } from "@/schemas/common.schema";

/** The fields a template shares with the expenses it raises. */
const templateShape = {
  amountPaise: z.number().int().positive().max(MAX_ENTRY_PAISE),
  reason: z.string().min(2).max(200),
  paidToEntity: z.string().min(2).max(120),
  category: z.enum(EXPENSE_CATEGORIES),
  accountId: objectIdString,
  note: noteInputSchema,
};

/**
 * Section 6.3.4 — createExpenseTemplate.
 *
 * `startDate` MAY be in the future (schedule a rent that begins next month)
 * and MAY be in the past (backfill a salary that has been running since
 * April — rollover will catch up every missed period on its next run). It is
 * therefore not bound by the not-in-the-future rule that governs a real
 * expense's `spentAt`: a template describes intent, not money that moved.
 *
 * `billingDay` is optional here and defaulted from `startDate` by the
 * service, mirroring how createClient defaults a retainer's billing day.
 */
export const createExpenseTemplateSchema = z.strictObject({
  ...templateShape,
  startDate: z.date(),
  billingDay: z.number().int().min(1).max(31).optional(),
  idempotencyKey: z.string().min(1),
});
export type CreateExpenseTemplateInput = z.infer<typeof createExpenseTemplateSchema>;

/**
 * `startDate` is absent on purpose: it is the anchor every already-raised
 * period was advanced from, so editing it would silently re-date history.
 * To start a recurring expense on a different date, pause this template and
 * create a new one.
 */
export const updateExpenseTemplateSchema = z.strictObject({
  templateId: objectIdString,
  ...templateShape,
  billingDay: z.number().int().min(1).max(31),
  version: z.number().int().min(0),
});
export type UpdateExpenseTemplateInput = z.infer<typeof updateExpenseTemplateSchema>;

export const pauseExpenseTemplateSchema = z.strictObject({
  templateId: objectIdString,
  reason: z.string().min(2).max(200),
});
export type PauseExpenseTemplateInput = z.infer<typeof pauseExpenseTemplateSchema>;

export const resumeExpenseTemplateSchema = z.strictObject({
  templateId: objectIdString,
});
export type ResumeExpenseTemplateInput = z.infer<typeof resumeExpenseTemplateSchema>;
