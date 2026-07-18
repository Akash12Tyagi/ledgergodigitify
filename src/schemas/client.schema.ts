import { z } from "zod";

import { CLIENT_ENGAGEMENT_TYPES } from "@/constants/domain";
import { MAX_ENTRY_PAISE } from "@/constants/finance";

// Section 5.2 / 7.3 / 10.5 — shared verbatim by the create-client form and
// createClientAction. The 5 required fields (name, service, engagementType,
// amountPaise, nextDueDate) match Section 7.3's "Basics" section exactly.
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const PHONE_RE = /^\+?\d{7,15}$/;

export const clientInputSchema = z.strictObject({
  name: z.string().min(2).max(120),
  service: z.string().min(2).max(120),
  engagementType: z.enum(CLIENT_ENGAGEMENT_TYPES),
  amountPaise: z.number().int().positive().max(MAX_ENTRY_PAISE),
  nextDueDate: z.date(),
  billingDay: z.number().int().min(1).max(31).nullable().optional(),
  email: z.email().nullable().optional(),
  phone: z.string().regex(PHONE_RE, "Invalid phone number").nullable().optional(),
  company: z.string().max(120).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  gstin: z.string().regex(GSTIN_RE, "Invalid GSTIN").nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
export type ClientInput = z.infer<typeof clientInputSchema>;

// Section 6.7 — optimistic-lock update; `version` must be supplied.
export const updateClientSchema = clientInputSchema.partial({
  name: true,
  service: true,
  engagementType: true,
  amountPaise: true,
  nextDueDate: true,
}).extend({
  version: z.number().int().min(0),
});
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
