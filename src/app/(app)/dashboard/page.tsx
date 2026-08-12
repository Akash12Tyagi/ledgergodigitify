import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";

import { PageHeader } from "@/components/shared/PageHeader";
import { DrilldownCard } from "@/components/shared/DrilldownCard";
import { AmountText } from "@/components/shared/AmountText";
import { PeriodRangePicker } from "@/components/shared/PeriodRangePicker";
import { ReconciliationBanner } from "@/components/shared/ReconciliationBanner";
import { EmptyState } from "@/components/shared/EmptyState";
import { SparklineChartLazy } from "@/components/shared/charts/SparklineChartLazy";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDashboardRangeData } from "@/server/services/financial-engine";
import { getPendingExpenseCount } from "@/server/services/expenses.service";
import { getOutstandingBorrowedTotal } from "@/server/services/borrowings.service";
import { getSettings } from "@/server/services/settings.service";
import { KpiCard } from "@/components/shared/KpiCard";
import { requireUser } from "@/server/auth/guards";
import { PERIOD_FROM_COOKIE, PERIOD_TO_COOKIE, resolvePeriodRange } from "@/lib/period-range-context";
import { formatMonthLabel, nowIST, toMonthKey } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import type { AccountStripItem, DueRow, TxRow } from "@/types/engine";

// Section 9/15 — SparklineChartLazy is a "use client" component that
// defers Recharts (~99KB gzipped) via React.lazy + Suspense, keeping it
// out of this route's First Load JS budget. `next/dynamic(...,
// {ssr:false})` would do the same but Next.js 16 no longer allows that
// combinator inside a Server Component (AGENTS.md: breaking changes vs.
// training data) — React.lazy achieves the same deferral and isn't a
// Next-specific API.

export const metadata: Metadata = { title: "Dashboard — Finance & Ledger" };
export const dynamic = "force-dynamic";

// Section 7.1/1.3 Flow B — ONE composed call (getDashboardRangeData),
// internals parallelized (Section 9). Money math never happens client-side.
export default async function DashboardPage() {
  await requireUser("viewer");
  const cookieStore = await cookies();
  const currentRealMonth = toMonthKey(nowIST());
  const { from: fromMonthKey, to: toMonthKeyValue } = resolvePeriodRange(
    cookieStore.get(PERIOD_FROM_COOKIE)?.value,
    cookieStore.get(PERIOD_TO_COOKIE)?.value,
    currentRealMonth
  );

  const [data, settings, pendingExpenses, lentOutPaise] = await Promise.all([
    getDashboardRangeData(fromMonthKey, toMonthKeyValue),
    getSettings(),
    getPendingExpenseCount(),
    getOutstandingBorrowedTotal(),
  ]);
  const { overview } = data;
  // The picker's only lower bound is an explicitly configured go-live date
  // (Settings). Without one, users can browse back to any previous month —
  // there is no implicit floor at "the earliest transaction on record",
  // since that silently blocks navigation for any company whose ledger
  // history is still short (everything shows ₹0 for empty months, which is
  // correct, not broken).
  const minMonthKey = settings.goLiveDate ? toMonthKey(settings.goLiveDate) : undefined;
  const rangeLabel =
    fromMonthKey === toMonthKeyValue
      ? formatMonthLabel(toMonthKeyValue)
      : `${formatMonthLabel(fromMonthKey)} – ${formatMonthLabel(toMonthKeyValue)}`;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        action={
          <PeriodRangePicker
            fromMonthKey={fromMonthKey}
            toMonthKey={toMonthKeyValue}
            minMonthKey={minMonthKey}
          />
        }
      />

      {overview.reconciliationError ? (
        <div className="mb-6">
          <ReconciliationBanner />
        </div>
      ) : (
        <>
          {/* Things a person has to DO, above everything they merely have
              to know. Rendered only when non-empty — a permanent strip
              saying "0 things need attention" is noise that trains people
              to skip the row that will one day matter. */}
          <AttentionStrip
            pendingExpenses={pendingExpenses}
            overdueDuesPaise={overview.overduePaise}
          />

          {/* Cash first, and stated as one number. The old layout opened
              with Outstanding Dues — money that has NOT arrived — so the
              most prominent figure on the dashboard was the one you cannot
              spend. */}
          <section className="mb-6 grid gap-2">
            <h2 className="text-sm font-medium">Money you have</h2>
            <div className="grid gap-3 lg:grid-cols-[minmax(0,18rem)_1fr]">
              <KpiCard
                label="Across all accounts"
                value={<AmountText paise={overview.closingPositionPaise} tone="neutral" />}
              />
              {data.accounts.length > 0 ? (
                <div className="flex flex-wrap gap-3">
                  {data.accounts.map((account) => (
                    <AccountChip key={account.accountId} account={account} />
                  ))}
                </div>
              ) : null}
            </div>
          </section>

          {/* Deliberately separate from the cash block: none of this is
              money you can spend today. */}
          <section className="mb-6 grid gap-2">
            <h2 className="text-sm font-medium">Owed to you</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <DrilldownCard
                label="Outstanding dues"
                value={formatINR(overview.outstandingDuesPaise)}
                href="/ledger/dues"
                ariaLabel={`View outstanding dues, totalling ${formatINR(overview.outstandingDuesPaise)}`}
                tone={overview.outstandingDuesPaise > 0 ? "warn" : "neutral"}
              />
              <DrilldownCard
                label="Overdue from clients"
                value={formatINR(overview.overduePaise)}
                href="/ledger/dues"
                ariaLabel={`View overdue dues, totalling ${formatINR(overview.overduePaise)}`}
                tone={overview.overduePaise > 0 ? "danger" : "neutral"}
              />
              <DrilldownCard
                label="Lent to people"
                value={formatINR(lentOutPaise)}
                href="/ledger/borrowers"
                ariaLabel={`View money lent out, totalling ${formatINR(lentOutPaise)}`}
                tone={lentOutPaise > 0 ? "warn" : "neutral"}
              />
            </div>
          </section>

          <section className="mb-6 grid gap-2">
            <h2 className="text-sm font-medium">Cash movement — {rangeLabel}</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <DrilldownCard
                label="Collected"
                value={formatINR(overview.collectedPaise)}
                href={`/ledger/overview?type=PAYMENT_IN`}
                ariaLabel={`View payments collected in this period, totalling ${formatINR(overview.collectedPaise)}`}
              />
              <DrilldownCard
                label="Expenses"
                value={formatINR(overview.expensesPaise)}
                href={`/ledger/overview?type=EXPENSE_OUT`}
                ariaLabel={`View expenses in this period, totalling ${formatINR(overview.expensesPaise)}`}
                tone={overview.expensesPaise > 0 ? "warn" : "neutral"}
              />
              <KpiCard
                label="Net change"
                value={<AmountText paise={overview.netCashFlowPaise} tone="auto" showSign />}
              />
            </div>
          </section>

          <div className="mb-6 grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Dues This Week</CardTitle>
              </CardHeader>
              <CardContent>
                {data.duesThisWeek.length === 0 ? (
                  <EmptyState title="Nothing due this week" />
                ) : (
                  <div className="grid gap-2">
                    {data.duesThisWeek.map((due) => (
                      <DueRowLine key={due.clientId} due={due} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Recent Activity</CardTitle>
              </CardHeader>
              <CardContent>
                {data.recentActivity.length === 0 ? (
                  <EmptyState title="No activity yet" />
                ) : (
                  <div className="grid gap-2">
                    {data.recentActivity.map((tx) => (
                      <ActivityLine key={tx.id} tx={tx} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Collected vs Expenses — last 6 months</CardTitle>
            </CardHeader>
            <CardContent>
              <SparklineChartLazy points={data.sparkline} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

/** The "do something" row. Each item is a link to the screen where the
 * doing happens, not just a number — a count you cannot act on from where
 * you read it is a dead end. */
function AttentionStrip({
  pendingExpenses,
  overdueDuesPaise,
}: {
  pendingExpenses: number;
  overdueDuesPaise: number;
}) {
  const items: { href: string; text: string; tone: "warn" | "danger" }[] = [];

  if (pendingExpenses > 0) {
    items.push({
      href: "/ledger/expenses?status=pending",
      text: `${pendingExpenses} expense${pendingExpenses === 1 ? "" : "s"} waiting for approval`,
      tone: "warn",
    });
  }
  if (overdueDuesPaise > 0) {
    items.push({
      href: "/ledger/dues",
      text: `${formatINR(overdueDuesPaise)} overdue from clients`,
      tone: "danger",
    });
  }

  if (items.length === 0) return null;

  return (
    <div className="mb-6 flex flex-wrap gap-2">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={
            item.tone === "danger"
              ? "flex items-center gap-2 rounded-md border border-money-out/30 bg-money-out/5 px-3 py-2 text-sm font-medium text-money-out hover:bg-money-out/10"
              : "flex items-center gap-2 rounded-md border border-warn/30 bg-warn/5 px-3 py-2 text-sm font-medium text-warn hover:bg-warn/10"
          }
        >
          {item.text}
        </Link>
      ))}
    </div>
  );
}

function AccountChip({ account }: { account: AccountStripItem }) {
  return (
    <Link
      href={`/ledger/accounts/${account.accountId}`}
      className="flex min-w-40 flex-col gap-0.5 rounded-lg border px-3 py-2 hover:bg-muted/40"
    >
      <span className="text-xs text-muted-foreground">{account.name}</span>
      <AmountText
        paise={account.balancePaise}
        tone={account.isLowBalance ? "out" : "neutral"}
        className="text-left text-base"
      />
      {account.isLowBalance ? <span className="text-xs text-warn">Low balance</span> : null}
    </Link>
  );
}

function DueRowLine({ due }: { due: DueRow }) {
  return (
    <Link
      href={`/clients/${due.clientId}?tab=dues`}
      className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-muted/40"
    >
      <span className="truncate">{due.clientName}</span>
      <AmountText paise={due.remainingPaise} tone={due.daysOverdue > 0 ? "out" : "neutral"} />
    </Link>
  );
}

function ActivityLine({ tx }: { tx: TxRow }) {
  return (
    <div className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm">
      <span className="truncate text-muted-foreground">
        {tx.counterpartyLabel ?? tx.type} · {tx.accountName}
      </span>
      <AmountText paise={tx.amountPaise} tone={tx.direction === "IN" ? "in" : "out"} />
    </div>
  );
}
