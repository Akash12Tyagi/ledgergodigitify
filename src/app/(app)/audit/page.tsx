import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/PageHeader";
import { AuditTableView } from "@/features/audit/components/AuditTableView";
import { listAuditLogs } from "@/server/services/audit.service";
import { requireUser } from "@/server/auth/guards";
import { PAGE_SIZE_DEFAULT } from "@/constants/finance";
import { AUDIT_ENTITY_KINDS, type AuditEntityKind } from "@/constants/audit-actions";

export const metadata: Metadata = { title: "Audit — Finance & Ledger" };
export const dynamic = "force-dynamic";

// Section 7.12 — /audit. Admin+ only (Section 1.2).
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireUser("admin");
  const params = await searchParams;

  const page = Math.max(1, Number(params.page ?? "1"));
  const pageSize = Math.max(1, Number(params.pageSize ?? String(PAGE_SIZE_DEFAULT)));
  const entityKind =
    params.entityKind && (AUDIT_ENTITY_KINDS as readonly string[]).includes(params.entityKind)
      ? (params.entityKind as AuditEntityKind)
      : undefined;

  const result = await listAuditLogs({ ...(entityKind ? { entityKind } : {}), page, pageSize });

  return (
    <div>
      <PageHeader title="Audit Log" />
      <AuditTableView rows={result.rows} total={result.total} page={result.page} pageSize={result.pageSize} />
    </div>
  );
}
