import mongoose, { Schema, type InferSchemaType } from "mongoose";

import { CLIENT_ENGAGEMENT_TYPES, CLIENT_STATUSES } from "@/constants/domain";

// Section 5.2 — clients.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?\d{7,15}$/;
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

const clientSchema = new Schema(
  {
    name: { type: String, required: true, minlength: 2, maxlength: 120 },
    service: { type: String, required: true, minlength: 2, maxlength: 120 },
    engagementType: { type: String, enum: CLIENT_ENGAGEMENT_TYPES, required: true },
    amountPaise: { type: Number, required: true, min: 1 },
    nextDueDate: { type: Date, required: true },
    // Retainer only; default = day-of-month of first nextDueDate, applied
    // by the service layer on create (Section 6.6), not here.
    billingDay: { type: Number, min: 1, max: 31, default: null },
    email: {
      type: String,
      default: null,
      validate: {
        validator: (v: string | null) => v === null || EMAIL_RE.test(v),
        message: "Invalid email",
      },
    },
    phone: {
      type: String,
      default: null,
      validate: {
        validator: (v: string | null) => v === null || PHONE_RE.test(v),
        message: "Invalid phone number",
      },
    },
    company: { type: String, default: null, maxlength: 120 },
    address: { type: String, default: null, maxlength: 500 },
    gstin: {
      type: String,
      default: null,
      validate: {
        validator: (v: string | null) => v === null || GSTIN_RE.test(v),
        message: "Invalid GSTIN",
      },
    },
    notes: { type: String, default: null, maxlength: 2000 },
    status: { type: String, enum: CLIENT_STATUSES, default: "active" },
    archivedAt: { type: Date, default: null },
    archiveReason: { type: String, default: null },
    version: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true, collection: "clients" }
);

clientSchema.index({ name: "text", company: "text", service: "text" });
clientSchema.index({ status: 1, nextDueDate: 1 });
clientSchema.index({ engagementType: 1, status: 1 });

export type ClientDoc = InferSchemaType<typeof clientSchema>;

export const ClientModel =
  (mongoose.models.Client as mongoose.Model<ClientDoc>) ??
  mongoose.model<ClientDoc>("Client", clientSchema);
