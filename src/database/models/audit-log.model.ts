import mongoose, { Schema, type InferSchemaType } from "mongoose";

import { AUDIT_ACTIONS, AUDIT_ENTITY_KINDS } from "@/constants/audit-actions";

// Section 5.10 — append-only; no update/delete code path exists anywhere in
// the app (Law 3, Law 9). Written inside the same DB transaction as every
// mutation it records.
const auditLogSchema = new Schema(
  {
    actorUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    actorName: { type: String, required: true },
    action: { type: String, enum: AUDIT_ACTIONS, required: true },
    entity: {
      kind: { type: String, enum: AUDIT_ENTITY_KINDS, required: true },
      id: { type: Schema.Types.ObjectId, default: null },
    },
    before: { type: Schema.Types.Mixed, default: null },
    after: { type: Schema.Types.Mixed, default: null },
    summary: { type: String, required: true, maxlength: 200 },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
  },
  { timestamps: true, collection: "auditlogs" }
);

auditLogSchema.index({ "entity.kind": 1, "entity.id": 1, createdAt: -1 });
auditLogSchema.index({ actorUserId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

export type AuditLogDoc = InferSchemaType<typeof auditLogSchema>;

export const AuditLogModel =
  (mongoose.models.AuditLog as mongoose.Model<AuditLogDoc>) ??
  mongoose.model<AuditLogDoc>("AuditLog", auditLogSchema);
