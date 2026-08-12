"use client";

import * as React from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";

import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { LendMoneySheet } from "@/features/borrowings/components/LendMoneySheet";
import { buildBorrowingsColumns } from "@/features/borrowings/components/borrowings-columns";
import type { BorrowingRow } from "@/types/borrowing";
import type { UserRole } from "@/constants/roles";

export function BorrowingsTableView({
  rows,
  total,
  page,
  pageSize,
  role,
}: {
  rows: BorrowingRow[];
  total: number;
  page: number;
  pageSize: number;
  role: UserRole;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const canLend = role === "owner" || role === "admin";

  const [search, setSearch] = React.useState(searchParams.get("search") ?? "");

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== "all") params.set(key, value);
    else params.delete(key);
    params.set("page", "1");
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {canLend ? <LendMoneySheet role={role} /> : <span />}
        <div className="flex flex-wrap items-center gap-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setParam("search", search.trim());
            }}
          >
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name…"
              className="w-48"
              aria-label="Search borrowers by name"
            />
          </form>
          <Select
            value={searchParams.get("status") ?? "open"}
            onValueChange={(v) => setParam("status", v ?? "open")}
          >
            <SelectTrigger className="w-40">
              <SelectValue
                labels={{
                  open: "Still owed",
                  settled: "Fully repaid",
                  written_off: "Written off",
                  all: "All",
                }}
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Still owed</SelectItem>
              <SelectItem value="settled">Fully repaid</SelectItem>
              <SelectItem value="written_off">Written off</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <DataTable
        columns={buildBorrowingsColumns(role)}
        data={rows}
        total={total}
        page={page}
        pageSize={pageSize}
        emptyState={
          <EmptyState
            title="Nobody owes you anything"
            description={
              canLend
                ? "When you lend money to someone, record it here so it stays tracked until it comes back."
                : "Money lent out will appear here."
            }
          />
        }
      />
    </div>
  );
}
