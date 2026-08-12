import type { Metadata } from "next";
import { cookies } from "next/headers";

import { PageHeader } from "@/components/shared/PageHeader";
import { DrilldownCard } from "@/components/shared/DrilldownCard";
import { CashFlowSummary } from "@/components/shared/CashFlowSummary";
import { AmountText } from "@/components/shared/AmountText";
import { PeriodRangePicker } from "@/components/shared/PeriodRangePicker";
import { ReconciliationBanner } from "@/components/shared/ReconciliationBanner";
import { DevSumAssertion } from "@/components/shared/DevSumAssertion";
import { TransactionsTableView } from "@/components/shared/TransactionsTableView";
import { ExpenseCategoryChartLazy } from "@/components/shared/charts/ExpenseCategoryChartLazy";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getRangeOverview, listTransactions, sumFilteredTransactions } from "@/server/services/financial-engine";
import { getSettings } from "@/server/services/settings.service";
import { requireUser } from "@/server/auth/guards";
import { PERIOD_FROM_COOKIE, PERIOD_TO_COOKIE, resolvePeriodRange } from "@/lib/period-range-context";
import { formatMonthLabel, nowIST, toMonthKey } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import { PAGE_SIZE_DEFAULT } from "@/constants/finance";
import { TRANSACTION_TYPES, type TransactionType } from "@/constants/domain";

// See dashboard/page.tsx's comment: ExpenseCategoryChartLazy defers
// Recharts via React.lazy + Suspense, keeping it out of this route's
// First Load JS budget (Section 9/15).

export const metadata: Metadata = { title: "Ledger Overview — Finance & Ledger" };
export const dynamic = "force-dynamic";

// Section 7.5/4.3 — the "money mathematics" math block: opening + billed +
// collected + credits - expenses = closing, each collected/credits/
// expenses card a DrilldownCard onto the SAME-filtered transaction list
// below it (Section 4.6 sibling-list rule).
export default async function LedgerOverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireUser("viewer");
  const params = await searchParams;
  const cookieStore = await cookies();
  // The same cookie pair the Dashboard reads — one period for the whole app.
  const { from: fromMonthKey, to: toMonthKeyValue } = resolvePeriodRange(
    cookieStore.get(PERIOD_FROM_COOKIE)?.value,
    cookieStore.get(PERIOD_TO_COOKIE)?.value,
    toMonthKey(nowIST())
  );

  const page = Math.max(1, Number(params.page ?? "1"));
  const pageSize = Math.max(1, Number(params.pageSize ?? String(PAGE_SIZE_DEFAULT)));
  const typeParam = params.type;
  const type =
    typeParam && (TRANSACTION_TYPES as readonly string[]).includes(typeParam)
      ? [typeParam as TransactionType]
      : undefined;

  // The transaction list is scoped to the SAME month span the cards above
  // it total, so "card === sum(rows)" still holds by construction once the
  // period can cover more than one month.
  const periodFilter = { monthKeyFrom: fromMonthKey, monthKeyTo: toMonthKeyValue };

  const [overview, txList, settings] = await Promise.all([
    getRangeOverview(fromMonthKey, toMonthKeyValue),
    listTransactions({ ...periodFilter, ...(type ? { type } : {}), page, pageSize }),
    getSettings(),
  ]);

  const minMonthKey = settings.goLiveDate ? toMonthKey(settings.goLiveDate) : undefined;
  const rangeLabel =
    fromMonthKey === toMonthKeyValue
      ? formatMonthLabel(toMonthKeyValue)
      : `${formatMonthLabel(fromMonthKey)} – ${formatMonthLabel(toMonthKeyValue)}`;

  let assertionLabel: string | null = null;
  let expectedPaise = 0;
  if (type?.length === 1) {
    if (type[0] === "PAYMENT_IN") {
      assertionLabel = "Collected";
      expectedPaise = overview.collectedPaise;
    } else if (type[0] === "CREDIT_IN") {
      assertionLabel = "Credits";
      expectedPaise = overview.creditsPaise;
    } else if (type[0] === "EXPENSE_OUT") {
      assertionLabel = "Expenses";
      expectedPaise = overview.expensesPaise;
    }
  }
  const actualPaise = assertionLabel
    ? await sumFilteredTransactions({ ...periodFilter, ...(type ? { type } : {}) })
    : 0;

  return (
    <div>
      <PageHeader
        title="Ledger Overview"
        description="Where your money went this period, and what is still owed to you."
        action={
          <PeriodRangePicker
            fromMonthKey={fromMonthKey}
            toMonthKey={toMonthKeyValue}
            minMonthKey={minMonthKey}
          />
        }
      />

      {overview.reconciliationError ? (
        <ReconciliationBanner />
      ) : (
        <div className="grid gap-6">
          {assertionLabel ? (
            <DevSumAssertion label={assertionLabel} expectedPaise={expectedPaise} actualPaise={actualPaise} />
          ) : null}

          <section className="grid gap-2">
            <h2 className="text-sm font-medium">Cash — {rangeLabel}</h2>
            <CashFlowSummary
              openingPaise={overview.openingPositionPaise}
              collectedPaise={overview.collectedPaise}
              creditsPaise={overview.creditsPaise}
              expensesPaise={overview.expensesPaise}
              lentPaise={overview.lentPaise}
              loanRepaidPaise={overview.loanRepaidPaise}
              adjustmentsNetPaise={overview.adjustmentsNetPaise}
              closingPaise={overview.closingPositionPaise}
            />
            <p className="text-xs text-muted-foreground">
              Net change this period:{" "}
              <AmountText paise={overview.netCashFlowPaise} tone="auto" showSign />
            </p>
          </section>

          {/* Kept strictly apart from the cash block above. These are
              promises, not money in an account: counting them together is
              the single easiest way to believe you are richer than you are. */}
          <section className="grid gap-2">
            <h2 className="text-sm font-medium">Owed to you</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <DrilldownCard
                label={`Billed — ${rangeLabel}`}
                value={formatINR(overview.billedPaise)}
                href="/ledger/billed"
                ariaLabel={`View clients billed this period, totalling ${formatINR(overview.billedPaise)}`}
              />
              <DrilldownCard
                label="Outstanding (all time)"
                value={formatINR(overview.outstandingDuesPaise)}
                href="/ledger/dues"
                ariaLabel={`View all unpaid dues, totalling ${formatINR(overview.outstandingDuesPaise)}`}
                tone={overview.outstandingDuesPaise > 0 ? "warn" : "neutral"}
              />
              <DrilldownCard
                label="Overdue"
                value={formatINR(overview.overduePaise)}
                href="/ledger/dues"
                ariaLabel={`View overdue dues, totalling ${formatINR(overview.overduePaise)}`}
                tone={overview.overduePaise > 0 ? "danger" : "neutral"}
              />
            </div>
          </section>

          <Card id="per-account">
            <CardHeader>
              <CardTitle className="text-sm font-medium">
                Where the money sits
                <span className="ml-2 font-normal text-muted-foreground">
                  — the same totals, split by account
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground">
                    <th className="py-1.5 pr-3 text-left font-medium">Account</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Opening</th>
                    <th className="py-1.5 pr-3 text-right font-medium">In</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Out</th>
                    <th className="py-1.5 text-right font-medium">Closing</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.perAccount.map((row) => (
                    <tr key={row.accountId} className="border-t">
                      <td className="py-1.5 pr-3">{row.name}</td>
                      <td className="py-1.5 pr-3 text-right">
                        <AmountText paise={row.openingPaise} />
                      </td>
                      <td className="py-1.5 pr-3 text-right">
                        <AmountText paise={row.inPaise} tone="in" />
                      </td>
                      <td className="py-1.5 pr-3 text-right">
                        <AmountText paise={row.outPaise} tone="out" />
                      </td>
                      <td className="py-1.5 text-right">
                        <AmountText paise={row.closingPaise} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {overview.expenseByCategory.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Expenses by Category</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <ExpenseCategoryChartLazy rows={overview.expenseByCategory} />
                <div className="grid content-center gap-1">
                  {overview.expenseByCategory.map((row) => (
                    <div key={row.category} className="flex items-center justify-between text-sm">
                      <span className="capitalize">{row.category}</span>
                      <AmountText paise={row.totalPaise} tone="out" />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

          <TransactionsTableView rows={txList.rows} total={txList.total} page={txList.page} pageSize={txList.pageSize} />
        </div>
      )}
    </div>
  );
}
