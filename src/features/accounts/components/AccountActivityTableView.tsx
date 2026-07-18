"use client";

import { DataTable } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { buildAccountActivityColumns } from "@/features/accounts/components/account-activity-columns";
import type { ActivityRow } from "@/types/engine";
import type { UserRole } from "@/constants/roles";

export function AccountActivityTableView({
  rows,
  total,
  page,
  pageSize,
  role,
}: {
  rows: ActivityRow[];
  total: number;
  page: number;
  pageSize: number;
  role: UserRole;
}) {
  return (
    <DataTable
      columns={buildAccountActivityColumns(role)}
      data={rows}
      total={total}
      page={page}
      pageSize={pageSize}
      emptyState={<EmptyState title="No activity yet" description="Payments, expenses, credits, and transfers on this account will appear here." />}
    />
  );
}
