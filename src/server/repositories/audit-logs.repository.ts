import type { ClientSession, Types } from "mongoose";

import { db } from "@/database/connection";
import { AuditLogModel } from "@/database/models/audit-log.model";
import type { AuditAction, AuditEntityKind } from "@/constants/audit-actions";

export type LogAuditInput = {
  actorUserId: string | Types.ObjectId;
  actorName: string;
  action: AuditAction;
  entity: { kind: AuditEntityKind; id?: string | Types.ObjectId | null };
  before?: unknown;
  after?: unknown;
  summary: string;
  ip?: string | null;
  userAgent?: string | null;
};

/** Section 7.4 "activity" tab / Section 7.12 /audit page. */
export async function findAuditLogsByEntity(kind: AuditEntityKind, id: string) {
  await db();
  return AuditLogModel.find({ "entity.kind": kind, "entity.id": id })
    .sort({ createdAt: -1 })
    .lean();
}

export type AuditLogListFilter = {
  action?: AuditAction;
  entityKind?: AuditEntityKind;
  page?: number;
  pageSize?: number;
};

/** Section 7.12 — /audit, server-paginated (Section 14 edge case 33). */
export async function findAuditLogsPaginated(filter: AuditLogListFilter) {
  await db();
  const page = filter.page ?? 1;
  const pageSize = filter.pageSize ?? 20;
  const match: Record<string, unknown> = {};
  if (filter.action) match.action = filter.action;
  if (filter.entityKind) match["entity.kind"] = filter.entityKind;

  const [rows, total] = await Promise.all([
    AuditLogModel.find(match)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    AuditLogModel.countDocuments(match),
  ]);

  return { rows, total, page, pageSize };
}

export async function insertAuditLog(input: LogAuditInput, session?: ClientSession) {
  await db();
  await AuditLogModel.create(
    [
      {
        actorUserId: input.actorUserId,
        actorName: input.actorName,
        action: input.action,
        entity: { kind: input.entity.kind, id: input.entity.id ?? null },
        before: input.before ?? null,
        after: input.after ?? null,
        summary: input.summary,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      },
    ],
    session ? { session } : undefined
  );
}
