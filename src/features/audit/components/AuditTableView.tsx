"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { auditColumns } from "@/features/audit/components/audit-columns";
import { AUDIT_ENTITY_KINDS } from "@/constants/audit-actions";
import type { AuditLogRow } from "@/types/audit-log";

export function AuditTableView({
  rows,
  total,
  page,
  pageSize,
}: {
  rows: AuditLogRow[];
  total: number;
  page: number;
  pageSize: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setEntityKind(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== "all") params.set("entityKind", value);
    else params.delete("entityKind");
    params.set("page", "1");
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="grid gap-3">
      <div className="flex justify-end">
        <Select value={searchParams.get("entityKind") ?? "all"} onValueChange={(v) => setEntityKind(v ?? "all")}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All entities</SelectItem>
            {AUDIT_ENTITY_KINDS.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {kind}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={auditColumns}
        data={rows}
        total={total}
        page={page}
        pageSize={pageSize}
        emptyState={<EmptyState title="No audit entries" />}
      />
    </div>
  );
}
