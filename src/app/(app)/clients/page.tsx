import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/PageHeader";
import { ClientsTableView } from "@/features/clients/components/ClientsTableView";
import { getClientsListView } from "@/server/services/clients.service";
import { findClientsFiltered } from "@/server/repositories/clients.repository";
import { toMonthKey, nowIST } from "@/lib/dates";
import { PAGE_SIZE_DEFAULT } from "@/constants/finance";
import type { ClientEngagementType, ClientStatus } from "@/constants/domain";

export const metadata: Metadata = { title: "Clients — Finance & Ledger" };
export const dynamic = "force-dynamic";

// Section 7.2 — one composed data call per page (Section 9); pagination
// happens in-memory over the already-filtered set since the "This Month"
// status depends on a per-client engine call, not a stored field (see
// clients.service.ts#getClientsListView).
export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? "1"));
  const pageSize = Math.max(1, Number(params.pageSize ?? String(PAGE_SIZE_DEFAULT)));
  const status = (params.status as ClientStatus | "all" | undefined) ?? "active";
  const engagementType = (params.type as ClientEngagementType | "all" | undefined) ?? "all";
  const search = params.search;

  const monthKey = toMonthKey(nowIST());
  const filter = { status, engagementType, ...(search ? { search } : {}) };

  const [allRows, hasAnyClientsAtAll] = await Promise.all([
    getClientsListView(filter, monthKey),
    findClientsFiltered({ status: "all" }).then((c) => c.length > 0),
  ]);

  const total = allRows.length;
  const pageRows = allRows.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div>
      <PageHeader title="Clients" />
      <ClientsTableView
        rows={pageRows}
        total={total}
        page={page}
        pageSize={pageSize}
        hasAnyClientsAtAll={hasAnyClientsAtAll}
      />
    </div>
  );
}
