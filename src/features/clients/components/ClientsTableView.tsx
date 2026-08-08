"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { clientsColumns } from "@/features/clients/components/clients-columns";
import { SEARCH_DEBOUNCE_MS } from "@/constants/finance";
import type { ClientListRow } from "@/types/client";

// Section 7.2 — search + Status/Type filters, all synced to the URL
// (Section 8.4). Empty-first-run vs empty-filtered are distinct states
// (Section 14 edge case 32).
export function ClientsTableView({
  rows,
  total,
  page,
  pageSize,
  hasAnyClientsAtAll,
}: {
  rows: ClientListRow[];
  total: number;
  page: number;
  pageSize: number;
  hasAnyClientsAtAll: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [searchInput, setSearchInput] = React.useState(searchParams.get("search") ?? "");

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    params.set("page", "1");
    router.push(`${pathname}?${params.toString()}`);
  }

  React.useEffect(() => {
    const handle = setTimeout(() => {
      if (searchInput !== (searchParams.get("search") ?? "")) setParam("search", searchInput);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounce on searchInput only
  }, [searchInput]);

  const isFiltered = Boolean(
    searchParams.get("search") || searchParams.get("status") || searchParams.get("type") || searchParams.get("thisMonth")
  );

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button render={<Link href="/clients/new" />}>
          <PlusIcon /> New Client
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Search name, company, service…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-56"
          />
          <Select
            value={searchParams.get("status") ?? "active"}
            onValueChange={(v) => setParam("status", v ?? "active")}
          >
            <SelectTrigger className="w-36">
              <SelectValue
                labels={{ active: "Active", paused: "Paused", archived: "Archived", all: "All" }}
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="paused">Paused</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={searchParams.get("type") ?? "all"}
            onValueChange={(v) => setParam("type", v ?? "all")}
          >
            <SelectTrigger className="w-36">
              <SelectValue
                labels={{ all: "All Types", retainer: "Retainer", one_time: "One-time" }}
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="retainer">Retainer</SelectItem>
              <SelectItem value="one_time">One-time</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <DataTable
        columns={clientsColumns}
        data={rows}
        total={total}
        page={page}
        pageSize={pageSize}
        rowHref={(row) => `/clients/${row.id}`}
        emptyState={
          !hasAnyClientsAtAll ? (
            <EmptyState
              title="No clients yet"
              description="Add your first client to start tracking billing and payments."
              action={
                <Button render={<Link href="/clients/new" />}>
                  <PlusIcon /> New Client
                </Button>
              }
            />
          ) : isFiltered ? (
            <EmptyState
              title="No clients match these filters"
              action={
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearchInput("");
                    router.push(pathname);
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : null
        }
      />
    </div>
  );
}
