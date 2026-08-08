import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/PageHeader";
import { ClientsTableView } from "@/features/clients/components/ClientsTableView";
import { getClientsListView } from "@/server/services/clients.service";
import { countClientsFiltered } from "@/server/repositories/clients.repository";
import { PAGE_SIZE_DEFAULT } from "@/constants/finance";
import type { ClientEngagementType, ClientStatus } from "@/constants/domain";

export const metadata: Metadata = { title: "Clients — Finance & Ledger" };
export const dynamic = "force-dynamic";

// Section 7.2 — one composed data call per page (Section 9). Pagination is
// pushed down to Mongo (skip/limit in findClientsFiltered) so the "This
// Month" per-client engine calls in getClientsListView only run for the
// current page's rows, not the whole filtered roster (Section 15/M8
// hardening pass — this used to fetch+enrich every matching client, then
// slice in memory).
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

  // No monthKey here any more: a client's dues are period-based, so the row
  // reports their CURRENT period and their total across every open period —
  // figures that are true regardless of which month the Ledger is browsing,
  // and which therefore can't fall out of step with it.
  const filter = { status, engagementType, ...(search ? { search } : {}) };

  const [pageRows, total, hasAnyClientsAtAll] = await Promise.all([
    getClientsListView(filter, page, pageSize),
    countClientsFiltered(filter),
    countClientsFiltered({ status: "all" }).then((n) => n > 0),
  ]);

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
