import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shared/PageHeader";
import { DrilldownCard } from "@/components/shared/DrilldownCard";
import { AmountText } from "@/components/shared/AmountText";
import { EmptyState } from "@/components/shared/EmptyState";
import { DevSumAssertion } from "@/components/shared/DevSumAssertion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDuesList } from "@/server/services/financial-engine";
import { requireUser } from "@/server/auth/guards";
import { todayIST } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import type { DueRow } from "@/types/engine";

export const metadata: Metadata = { title: "Dues — Finance & Ledger" };
export const dynamic = "force-dynamic";

// Section 7.10 — overdue / due-soon / upcoming / archived-with-dues, each
// bucket's header total a DrilldownCard onto that SAME bucket's list right
// below it (an in-page anchor rather than a separate route, since the
// bucket rows are already the full drill-down — no further pagination).
export default async function LedgerDuesPage() {
  await requireUser("viewer");
  const dues = await getDuesList(todayIST());

  const sum = (rows: DueRow[]) => rows.reduce((s, r) => s + r.remainingPaise, 0);

  return (
    <div>
      <PageHeader title="Dues" />

      <DevSumAssertion label="Overdue" expectedPaise={dues.overdueTotalPaise} actualPaise={sum(dues.overdue)} />
      <DevSumAssertion label="Due Soon" expectedPaise={dues.dueSoonTotalPaise} actualPaise={sum(dues.dueSoon)} />
      <DevSumAssertion label="Upcoming" expectedPaise={dues.upcomingTotalPaise} actualPaise={sum(dues.upcoming)} />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <DrilldownCard
          label="Overdue"
          value={formatINR(dues.overdueTotalPaise)}
          href="#overdue"
          ariaLabel={`View ${dues.overdue.length} overdue client${dues.overdue.length === 1 ? "" : "s"}, totalling ${formatINR(dues.overdueTotalPaise)}`}
          tone={dues.overdueTotalPaise > 0 ? "danger" : "neutral"}
        />
        <DrilldownCard
          label="Due Soon"
          value={formatINR(dues.dueSoonTotalPaise)}
          href="#due-soon"
          ariaLabel={`View ${dues.dueSoon.length} client${dues.dueSoon.length === 1 ? "" : "s"} due soon, totalling ${formatINR(dues.dueSoonTotalPaise)}`}
          tone={dues.dueSoonTotalPaise > 0 ? "warn" : "neutral"}
        />
        <DrilldownCard
          label="Upcoming"
          value={formatINR(dues.upcomingTotalPaise)}
          href="#upcoming"
          ariaLabel={`View ${dues.upcoming.length} upcoming client${dues.upcoming.length === 1 ? "" : "s"}, totalling ${formatINR(dues.upcomingTotalPaise)}`}
        />
      </div>

      <div className="grid gap-6">
        <DuesSection id="overdue" title="Overdue" rows={dues.overdue} />
        <DuesSection id="due-soon" title="Due Soon" rows={dues.dueSoon} />
        <DuesSection id="upcoming" title="Upcoming" rows={dues.upcoming} />
        {dues.archivedWithDues.length > 0 ? (
          <DuesSection id="archived" title="Archived clients with dues" rows={dues.archivedWithDues} />
        ) : null}
      </div>
    </div>
  );
}

function DuesSection({ id, title, rows }: { id: string; title: string; rows: DueRow[] }) {
  return (
    <Card id={id}>
      <CardHeader>
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState title="Nothing here" />
        ) : (
          <div className="grid gap-1">
            {rows.map((row) => (
              <Link
                key={row.clientId}
                href={`/clients/${row.clientId}?tab=dues`}
                className="flex items-center justify-between rounded-lg px-2 py-2 text-sm hover:bg-muted/40"
              >
                <div>
                  <p className="font-medium">{row.clientName}</p>
                  <p className="text-xs text-muted-foreground">
                    {row.monthsOwed.join(", ")}
                    {row.daysOverdue > 0
                      ? ` · ${row.daysOverdue} day${row.daysOverdue === 1 ? "" : "s"} overdue`
                      : ""}
                  </p>
                </div>
                <AmountText paise={row.remainingPaise} tone={row.daysOverdue > 0 ? "out" : "neutral"} />
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
