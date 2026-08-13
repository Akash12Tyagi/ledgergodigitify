"use client";

import * as React from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { OutsideWindowEmptyState } from "@/components/shared/OutsideWindowEmptyState";
import { CreateExpenseSheet } from "@/features/expenses/components/CreateExpenseSheet";
import { buildExpensesColumns } from "@/features/expenses/components/expenses-columns";
import { EXPENSE_CATEGORIES } from "@/constants/domain";
import type { ExpenseRow } from "@/types/expense";
import type { OutsideWindowSummary } from "@/types/list";
import type { UserRole } from "@/constants/roles";

export function ExpensesTableView({
  rows,
  total,
  page,
  pageSize,
  role,
  pendingCount = 0,
  rangeLabel,
  outsideWindow,
}: {
  rows: ExpenseRow[];
  total: number;
  page: number;
  pageSize: number;
  role: UserRole;
  /** Total awaiting approval, across every period — not just this page. */
  pendingCount?: number;
  /** The span this list is scoped to, for the empty state to name. */
  rangeLabel: string;
  /** Set only when the range hid every row — see OutsideWindowEmptyState. */
  outsideWindow: OutsideWindowSummary | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const status = searchParams.get("status") ?? "active";

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== "all") params.set(key, value);
    else params.delete(key);
    params.set("page", "1");
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="grid gap-4">
      {/* Recurring expenses are raised by the cron with nobody watching, so
          the queue has to announce itself — otherwise a salary sits unpaid
          purely because no one thought to change the status filter. */}
      {pendingCount > 0 && status !== "pending" ? (
        <button
          type="button"
          onClick={() => setParam("status", "pending")}
          className="flex w-full items-center gap-2 rounded-md border border-warn/30 bg-warn/5 px-3 py-2 text-left text-sm hover:bg-warn/10"
        >
          <span className="font-medium text-warn">
            {pendingCount} expense{pendingCount === 1 ? "" : "s"} awaiting approval
          </span>
          <span className="text-muted-foreground">— review and approve</span>
        </button>
      ) : null}

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
          <Select
            value={searchParams.get("status") ?? "active"}
            onValueChange={(v) => setParam("status", v ?? "active")}
          >
            <SelectTrigger className="w-44">
              <SelectValue
                labels={{
                  pending: "Awaiting approval",
                  active: "Posted",
                  reversed: "Reversed",
                  cancelled: "Cancelled",
                  all: "All",
                }}
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Awaiting approval</SelectItem>
              <SelectItem value="active">Posted</SelectItem>
              <SelectItem value="reversed">Reversed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
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
        emptyState={
          outsideWindow ? (
            <OutsideWindowEmptyState
              summary={outsideWindow}
              rangeLabel={rangeLabel}
              noun="expense"
              nounPlural="expenses"
            />
          ) : (
            <EmptyState title="No expenses yet" description="Record your first expense to see it here." />
          )
        }
      />
    </div>
  );
}
