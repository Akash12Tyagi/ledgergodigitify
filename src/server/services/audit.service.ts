import type { ClientSession } from "mongoose";

import {
  findAuditLogsByEntity,
  findAuditLogsPaginated,
  insertAuditLog,
  type AuditLogListFilter,
  type LogAuditInput,
} from "@/server/repositories/audit-logs.repository";
import type { AuditEntityKind } from "@/constants/audit-actions";
import type { AuditLogRow } from "@/types/audit-log";

export type { LogAuditInput, AuditLogListFilter, AuditLogRow };

/**
 * Law 9 — every mutation writes an AuditLog entry. Money-path mutations
 * (Section 6, from M3 onward) pass the active `session` so this insert is
 * part of the same DB transaction as the rest of the operation. Auth events
 * (M1: LOGIN/LOGIN_FAILED/LOGOUT/PASSWORD_CHANGED) are single-document
 * writes with no surrounding transaction, so `session` is omitted.
 */
export async function logAudit(input: LogAuditInput, session?: ClientSession): Promise<void> {
  await insertAuditLog(input, session);
}

/** Section 7.4 "activity" tab — audit entries for one entity, newest first. */
export async function getEntityAuditLog(kind: AuditEntityKind, id: string) {
  return findAuditLogsByEntity(kind, id);
}

/** Section 7.12 — /audit page, server-paginated. */
export async function listAuditLogs(filter: AuditLogListFilter) {
  const { rows, total, page, pageSize } = await findAuditLogsPaginated(filter);
  const items: AuditLogRow[] = rows.map((r) => ({
    id: r._id.toString(),
    actorName: r.actorName,
    action: r.action,
    entityKind: r.entity?.kind as AuditEntityKind,
    entityId: r.entity?.id ? r.entity.id.toString() : null,
    before: r.before ?? null,
    after: r.after ?? null,
    summary: r.summary,
    createdAt: r.createdAt.toISOString(),
  }));
  return { rows: items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}
