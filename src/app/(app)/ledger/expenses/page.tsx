import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/PageHeader";
import { ExpensesTableView } from "@/features/expenses/components/ExpensesTableView";
import { getPendingExpenseCount, listExpenses } from "@/server/services/expenses.service";
import { requireUser } from "@/server/auth/guards";
import { describeDateWindow, resolveDateRange } from "@/lib/date-range";
import { DateRangeFilter } from "@/components/shared/DateRangeFilter";
import { PAGE_SIZE_DEFAULT } from "@/constants/finance";
import type { ExpenseCategory, ExpenseStatus } from "@/constants/domain";

export const metadata: Metadata = { title: "Expenses — Finance & Ledger" };
export const dynamic = "force-dynamic";

// Section 7.6 — /ledger/expenses.
export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const actor = await requireUser("viewer");

  const page = Math.max(1, Number(params.page ?? "1"));
  const pageSize = Math.max(1, Number(params.pageSize ?? String(PAGE_SIZE_DEFAULT)));
  const category = (params.category as ExpenseCategory | "all" | undefined) ?? "all";
  const status = (params.status as ExpenseStatus | "all" | undefined) ?? "active";

  // All time unless ?from/?to narrow it. The list is the record of what was
  // spent; the Overview's Expenses card is what a given month totals, and
  // the two are allowed to describe different spans.
  const dateRange = resolveDateRange(params.from, params.to);

  /**
   * The approvals queue deliberately IGNORES both date filters. A pending
   * expense is dated when it is expected to be paid, which is routinely
   * outside whatever span is being viewed — scoping the queue would hide
   * last month's unapproved salary the moment the picker moved, which is
   * the one row that most needs to be seen.
   */
  const periodScope =
    status === "pending"
      ? {}
      : {
          // Spread, not `undefined`: on All time the keys must be absent, or
          // the repository builds an empty `$gte`/`$lt` matching nothing.
          ...(dateRange.startUTC ? { spentFrom: dateRange.startUTC } : {}),
          ...(dateRange.endUTC ? { spentTo: dateRange.endUTC } : {}),
        };

  const [result, pendingCount] = await Promise.all([
    listExpenses({ category, status, page, pageSize, ...periodScope }),
    getPendingExpenseCount(),
  ]);

  // The picker's own wording, reused by the empty state so the two name the
  // same span identically.
  const rangeLabel = describeDateWindow(dateRange.from, dateRange.to);

  return (
    <div>
      <PageHeader
        title="Expenses"
        {...(status === "pending"
          ? {
              description:
                "Everything awaiting approval, across every period — date filters do not apply here.",
            }
          : {})}
        // One period control per screen, deliberately. The month picker
        // stays on the aggregate screens it belongs to; a list gets the
        // finer-grained one, which falls back to — and displays — whatever
        // month period those screens are on, so the two never disagree
        // silently.
        action={<DateRangeFilter from={dateRange.from} to={dateRange.to} />}
      />
      <ExpensesTableView
        rows={result.rows}
        total={result.total}
        page={result.page}
        pageSize={result.pageSize}
        role={actor.role}
        pendingCount={pendingCount}
        rangeLabel={rangeLabel}
        outsideWindow={result.outsideWindow}
      />
    </div>
  );
}
