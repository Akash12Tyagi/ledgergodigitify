import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";

import { PageHeader } from "@/components/shared/PageHeader";
import { DrilldownCard } from "@/components/shared/DrilldownCard";
import { AmountText } from "@/components/shared/AmountText";
import { DashboardRangePicker } from "@/components/shared/DashboardRangePicker";
import { ReconciliationBanner } from "@/components/shared/ReconciliationBanner";
import { EmptyState } from "@/components/shared/EmptyState";
import { SparklineChartLazy } from "@/components/shared/charts/SparklineChartLazy";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDashboardRangeData } from "@/server/services/financial-engine";
import { getSettings } from "@/server/services/settings.service";
import { requireUser } from "@/server/auth/guards";
import { DASHBOARD_FROM_COOKIE, DASHBOARD_TO_COOKIE, resolveDashboardRange } from "@/lib/dashboard-range-context";
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
  const { from: fromMonthKey, to: toMonthKeyValue } = resolveDashboardRange(
    cookieStore.get(DASHBOARD_FROM_COOKIE)?.value,
    cookieStore.get(DASHBOARD_TO_COOKIE)?.value,
    currentRealMonth
  );

  const [data, settings] = await Promise.all([
    getDashboardRangeData(fromMonthKey, toMonthKeyValue),
    getSettings(),
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
          <DashboardRangePicker
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
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <DrilldownCard
              label="Outstanding Dues"
              value={formatINR(overview.outstandingDuesPaise)}
              href="/ledger/dues"
              ariaLabel={`View outstanding dues, totalling ${formatINR(overview.outstandingDuesPaise)}`}
              tone={overview.outstandingDuesPaise > 0 ? "warn" : "neutral"}
            />
            <DrilldownCard
              label="Overdue"
              value={formatINR(overview.overduePaise)}
              href="/ledger/dues"
              ariaLabel={`View overdue dues, totalling ${formatINR(overview.overduePaise)}`}
              tone={overview.overduePaise > 0 ? "danger" : "neutral"}
            />
            <DrilldownCard
              label={`Collected — ${rangeLabel}`}
              value={formatINR(overview.collectedPaise)}
              href={`/ledger/overview?type=PAYMENT_IN`}
              ariaLabel={`View payments collected in this period, totalling ${formatINR(overview.collectedPaise)}`}
            />
            <DrilldownCard
              label={`Expenses — ${rangeLabel}`}
              value={formatINR(overview.expensesPaise)}
              href={`/ledger/overview?type=EXPENSE_OUT`}
              ariaLabel={`View expenses in this period, totalling ${formatINR(overview.expensesPaise)}`}
              tone={overview.expensesPaise > 0 ? "warn" : "neutral"}
            />
          </div>

          {data.accounts.length > 0 ? (
            <div className="mb-6 flex flex-wrap gap-3">
              {data.accounts.map((account) => (
                <AccountChip key={account.accountId} account={account} />
              ))}
            </div>
          ) : null}

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
