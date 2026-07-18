import type { AuditAction, AuditEntityKind } from "@/constants/audit-actions";

// Section 7.12 — the /audit table row shape. Lives here (not in
// server/services/audit.service.ts) so client components can import the
// type without importing the service module itself (Section 3 layering).
export type AuditLogRow = {
  id: string;
  actorName: string;
  action: AuditAction;
  entityKind: AuditEntityKind;
  entityId: string | null;
  before: unknown;
  after: unknown;
  summary: string;
  createdAt: string;
};
