"use client";

import * as React from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { CreateExpenseTemplateSheet } from "@/features/expense-templates/components/CreateExpenseTemplateSheet";
import { buildExpenseTemplatesColumns } from "@/features/expense-templates/components/expense-templates-columns";
import { EXPENSE_CATEGORIES } from "@/constants/domain";
import type { ExpenseTemplateRow } from "@/types/expense";
import type { UserRole } from "@/constants/roles";

export function ExpenseTemplatesTableView({
  rows,
  total,
  page,
  pageSize,
  role,
}: {
  rows: ExpenseTemplateRow[];
  total: number;
  page: number;
  pageSize: number;
  role: UserRole;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isAdmin = role === "owner" || role === "admin";

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
        {isAdmin ? <CreateExpenseTemplateSheet /> : <span />}
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={searchParams.get("category") ?? "all"}
            onValueChange={(v) => setParam("category", v ?? "all")}
          >
            <SelectTrigger className="w-40">
              <SelectValue className="capitalize" labels={{ all: "All categories" }} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {EXPENSE_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c} className="capitalize">
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={searchParams.get("status") ?? "all"}
            onValueChange={(v) => setParam("status", v ?? "all")}
          >
            <SelectTrigger className="w-36">
              <SelectValue labels={{ active: "Active", paused: "Paused", all: "All" }} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="paused">Paused</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <DataTable
        columns={buildExpenseTemplatesColumns(role)}
        data={rows}
        total={total}
        page={page}
        pageSize={pageSize}
        emptyState={
          <EmptyState
            title="No recurring expenses yet"
            description="Set up rent, salaries or subscriptions once and they'll be raised for approval every month."
          />
        }
      />
    </div>
  );
}
