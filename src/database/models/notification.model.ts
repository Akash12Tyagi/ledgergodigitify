import mongoose, { Schema, type InferSchemaType } from "mongoose";

import {
  NOTIFICATION_AUDIENCES,
  NOTIFICATION_ENTITY_KINDS,
  NOTIFICATION_SEVERITIES,
  NOTIFICATION_TYPES,
} from "@/constants/domain";

// Section 5.9 — notifications. `dedupeKey` uniqueness is what makes cron
// jobs idempotent (Section 6.8, Section 14 edge case 41).
const notificationSchema = new Schema(
  {
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    severity: { type: String, enum: NOTIFICATION_SEVERITIES, required: true },
    title: { type: String, required: true, maxlength: 120 },
    body: { type: String, required: true, maxlength: 500 },
    entityRef: {
      kind: { type: String, enum: NOTIFICATION_ENTITY_KINDS, required: true },
      id: { type: Schema.Types.ObjectId, default: null },
    },
    href: { type: String, required: true },
    isRead: { type: Boolean, default: false },
    audience: { type: String, enum: NOTIFICATION_AUDIENCES, required: true },
    dedupeKey: { type: String, required: true },
  },
  { timestamps: true, collection: "notifications" }
);

notificationSchema.index({ isRead: 1, createdAt: -1 });
notificationSchema.index({ dedupeKey: 1 }, { unique: true });

export type NotificationDoc = InferSchemaType<typeof notificationSchema>;

export const NotificationModel =
  (mongoose.models.Notification as mongoose.Model<NotificationDoc>) ??
  mongoose.model<NotificationDoc>("Notification", notificationSchema);
