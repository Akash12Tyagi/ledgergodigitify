import type { AuditAction, AuditEntityKind } from "@/constants/audit-actions";

// Section 7.12 — the /audit table row shape. Lives here (not in
// server/services/audit.service.ts) so client components can import the
// type without importing the service module itself (Section 3 layering).
export type AuditLogRow = {
  id: string;
  actorName: string;
  /** The account behind the name. A user can be renamed; this is what
   * actually ties an entry to a person months later. */
  actorUserId: string;
  action: AuditAction;
  entityKind: AuditEntityKind;
  entityId: string | null;
  before: unknown;
  after: unknown;
  summary: string;
  createdAt: string;
  /** Stored on every entry since M1 but historically never surfaced — for a
   * finance trail, "from where" is half of "who". Null on entries written by
   * the cron, which has no request behind it. */
  ip: string | null;
  userAgent: string | null;
};
