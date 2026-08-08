import { z } from "zod";

import { MAX_ENTRY_PAISE } from "@/constants/finance";
import { objectIdString } from "@/schemas/common.schema";

// Manual dues — raising a billing period by hand, editing one that was
// entered wrong, or removing one that should never have existed.
//
// The period is entered as an explicit from/to rather than a month, because
// real engagements do not all run 1st-to-1st: 20th-to-20th and 7th-to-7th
// are just as common, and forcing them into a calendar month is what made
// dues invisible to the "this month" screens in the first place.

const periodShape = {
  periodStart: z.date(),
  periodEnd: z.date(),
  dueDate: z.date(),
  amountPaise: z.number().int().positive().max(MAX_ENTRY_PAISE),
  note: z.string().max(500).nullable().optional(),
};

/** periodEnd is EXCLUSIVE, so it must be strictly after periodStart — a
 * zero-length period would bill nothing while still occupying the
 * {clientId, periodStart} slot and blocking the real one. */
function refinePeriod<T extends { periodStart: Date; periodEnd: Date }>(schema: z.ZodType<T>) {
  return schema.refine((v) => v.periodEnd.getTime() > v.periodStart.getTime(), {
    message: "Period end must be after period start.",
    path: ["periodEnd"],
  });
}

export const createDueSchema = refinePeriod(
  z.strictObject({ clientId: objectIdString, ...periodShape })
);
export type CreateDueInput = z.infer<typeof createDueSchema>;

export const updateDueSchema = refinePeriod(
  z.strictObject({
    dueId: objectIdString,
    version: z.number().int().min(0),
    ...periodShape,
  })
);
export type UpdateDueInput = z.infer<typeof updateDueSchema>;

export const deleteDueSchema = z.strictObject({
  dueId: objectIdString,
  reason: z.string().min(5).max(200),
});
export type DeleteDueInput = z.infer<typeof deleteDueSchema>;
