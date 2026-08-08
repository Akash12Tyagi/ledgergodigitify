import type { Metadata } from "next";
import { cookies } from "next/headers";

import { PageHeader } from "@/components/shared/PageHeader";
import { PeriodRangePicker } from "@/components/shared/PeriodRangePicker";
import { ExpensesTableView } from "@/features/expenses/components/ExpensesTableView";
import { listExpenses } from "@/server/services/expenses.service";
import { getSettings } from "@/server/services/settings.service";
import { requireUser } from "@/server/auth/guards";
import { PERIOD_FROM_COOKIE, PERIOD_TO_COOKIE, resolvePeriodRange } from "@/lib/period-range-context";
import { monthRangeToUtc, nowIST, toMonthKey } from "@/lib/dates";
import { PAGE_SIZE_DEFAULT } from "@/constants/finance";
import type { ExpenseCategory } from "@/constants/domain";

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
  const status = (params.status as "active" | "reversed" | "all" | undefined) ?? "active";

  // Scoped to the app-wide period, so this list and the Overview's Expenses
  // card always describe the same span of time.
  const cookieStore = await cookies();
  const { from, to } = resolvePeriodRange(
    cookieStore.get(PERIOD_FROM_COOKIE)?.value,
    cookieStore.get(PERIOD_TO_COOKIE)?.value,
    toMonthKey(nowIST())
  );
  const { startUTC, endUTC } = monthRangeToUtc(from, to);

  const [result, settings] = await Promise.all([
    listExpenses({ category, status, page, pageSize, spentFrom: startUTC, spentTo: endUTC }),
    getSettings(),
  ]);

  return (
    <div>
      <PageHeader
        title="Expenses"
        action={
          <PeriodRangePicker
            fromMonthKey={from}
            toMonthKey={to}
            minMonthKey={settings.goLiveDate ? toMonthKey(settings.goLiveDate) : undefined}
          />
        }
      />
      <ExpensesTableView
        rows={result.rows}
        total={result.total}
        page={result.page}
        pageSize={result.pageSize}
        role={actor.role}
      />
    </div>
  );
}
