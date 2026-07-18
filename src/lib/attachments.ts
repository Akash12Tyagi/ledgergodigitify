import type { AttachmentMetaInput, StampedAttachmentMeta } from "@/types/attachment";

/** Section 5.11 — uploadedAt/uploadedBy are never trusted from the client;
 * this is the one place every service stamps them before an attachment
 * array reaches a repository insert. */
export function stampAttachments(
  attachments: AttachmentMetaInput[] | undefined,
  uploadedBy: string
): StampedAttachmentMeta[] {
  const uploadedAt = new Date();
  return (attachments ?? []).map((a) => ({ ...a, uploadedAt, uploadedBy }));
}
