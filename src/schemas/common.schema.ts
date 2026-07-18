import { z } from "zod";

import { ALLOWED_UPLOAD_MIME, MAX_ATTACHMENTS_PER_ENTITY, MAX_UPLOAD_BYTES } from "@/constants/finance";

// Section 10.15 — IDs in URLs/inputs are Mongo ObjectIds; validate format
// before it ever reaches a query (an invalid format must become
// NOT_FOUND, never a cast-error 500).
export const objectIdString = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, "Invalid id");

// Section 5.11 — AttachmentMeta, as accepted from the client after a
// direct-to-Cloudinary signed upload (Section 10.9). Server re-verifies
// declared mime vs Cloudinary's detected format on save (M4).
export const attachmentMetaInputSchema = z.strictObject({
  publicId: z.string().min(1),
  url: z.url(),
  originalName: z.string().max(200).optional(),
  bytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  mime: z.enum(ALLOWED_UPLOAD_MIME),
});

export const attachmentsInputSchema = z.array(attachmentMetaInputSchema).max(MAX_ATTACHMENTS_PER_ENTITY).optional();

export const noteInputSchema = z.string().max(500).nullable().optional();
