import type { Metadata } from "next";
import { cookies } from "next/headers";

import { PageHeader } from "@/components/shared/PageHeader";
import { ExpensesTableView } from "@/features/expenses/components/ExpensesTableView";
import { getPendingExpenseCount, listExpenses } from "@/server/services/expenses.service";
import { requireUser } from "@/server/auth/guards";
import { PERIOD_FROM_COOKIE, PERIOD_TO_COOKIE, resolvePeriodRange } from "@/lib/period-range-context";
import { formatMonthLabel, nowIST, toMonthKey } from "@/lib/dates";
import { resolveDateRange } from "@/lib/date-range";
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

  // Scoped to the app-wide period, so this list and the Overview's Expenses
  // card always describe the same span of time.
  const cookieStore = await cookies();
  const { from, to } = resolvePeriodRange(
    cookieStore.get(PERIOD_FROM_COOKIE)?.value,
    cookieStore.get(PERIOD_TO_COOKIE)?.value,
    toMonthKey(nowIST())
  );
  // Exact ?from/?to dates win over the month period when present; with
  // neither, this falls back to the very same months the Overview totals.
  const dateRange = resolveDateRange(params.from, params.to, { from, to });

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
      : { spentFrom: dateRange.startUTC, spentTo: dateRange.endUTC };

  const [result, pendingCount] = await Promise.all([
    listExpenses({ category, status, page, pageSize, ...periodScope }),
    getPendingExpenseCount(),
  ]);

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
        action={
          <DateRangeFilter
            from={dateRange.from}
            to={dateRange.to}
            fallbackLabel={
              from === to
                ? formatMonthLabel(to)
                : `${formatMonthLabel(from)} – ${formatMonthLabel(to)}`
            }
          />
        }
      />
      <ExpensesTableView
        rows={result.rows}
        total={result.total}
        page={result.page}
        pageSize={result.pageSize}
        role={actor.role}
        pendingCount={pendingCount}
      />
    </div>
  );
}
