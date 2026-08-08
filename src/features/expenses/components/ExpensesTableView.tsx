"use client";

import * as React from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { CreateExpenseSheet } from "@/features/expenses/components/CreateExpenseSheet";
import { buildExpensesColumns } from "@/features/expenses/components/expenses-columns";
import { EXPENSE_CATEGORIES } from "@/constants/domain";
import type { ExpenseRow } from "@/types/expense";
import type { UserRole } from "@/constants/roles";

export function ExpensesTableView({
  rows,
  total,
  page,
  pageSize,
  role,
}: {
  rows: ExpenseRow[];
  total: number;
  page: number;
  pageSize: number;
  role: UserRole;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

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
        <CreateExpenseSheet role={role} />
        <div className="flex flex-wrap items-center gap-2">
          <Select value={searchParams.get("category") ?? "all"} onValueChange={(v) => setParam("category", v ?? "all")}>
            <SelectTrigger className="w-40">
              {/* Categories are their own label, so only the sentinel needs
                  mapping; anything unmapped falls back to the raw value. */}
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
          <Select value={searchParams.get("status") ?? "active"} onValueChange={(v) => setParam("status", v ?? "active")}>
            <SelectTrigger className="w-36">
              <SelectValue labels={{ active: "Active", reversed: "Reversed", all: "All" }} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="reversed">Reversed</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <DataTable
        columns={buildExpensesColumns(role)}
        data={rows}
        total={total}
        page={page}
        pageSize={pageSize}
        emptyState={<EmptyState title="No expenses yet" description="Record your first expense to see it here." />}
      />
    </div>
  );
}
