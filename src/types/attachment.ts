import type { ALLOWED_UPLOAD_MIME } from "@/constants/finance";

// Section 5.11 — shared shape for AttachmentMeta as accepted from clients
// (before uploadedAt/uploadedBy are stamped server-side) and as stored.
export type AttachmentMetaInput = {
  publicId: string;
  url: string;
  originalName?: string | undefined;
  bytes: number;
  mime: (typeof ALLOWED_UPLOAD_MIME)[number];
};

/** As stored — uploadedAt/uploadedBy are stamped server-side (never
 * trusted from the client), matching attachment-meta.schema.ts's required
 * fields. See lib/attachments.ts#stampAttachments. */
export type StampedAttachmentMeta = AttachmentMetaInput & {
  uploadedAt: Date;
  uploadedBy: string;
};
