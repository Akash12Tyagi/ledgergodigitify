import { Schema } from "mongoose";

import { ALLOWED_UPLOAD_MIME, MAX_UPLOAD_BYTES } from "@/constants/finance";

// Section 5.11 — embedded subdocument, reused by payments/expenses/credits.
// Not a standalone collection, so it has no own model/index — Mongoose
// embeds it wherever it's referenced.
export const attachmentMetaSchema = new Schema(
  {
    publicId: { type: String, required: true },
    url: { type: String, required: true },
    originalName: { type: String, maxlength: 200 },
    bytes: { type: Number, max: MAX_UPLOAD_BYTES },
    mime: { type: String, enum: ALLOWED_UPLOAD_MIME },
    uploadedAt: { type: Date, required: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { _id: false }
);
