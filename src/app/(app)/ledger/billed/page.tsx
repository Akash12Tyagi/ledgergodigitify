import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";

import { PageHeader } from "@/components/shared/PageHeader";
import { AmountText } from "@/components/shared/AmountText";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { DevSumAssertion } from "@/components/shared/DevSumAssertion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getBilledClientsForRange, getRangeOverview } from "@/server/services/financial-engine";
import { requireUser } from "@/server/auth/guards";
import { PERIOD_FROM_COOKIE, PERIOD_TO_COOKIE, resolvePeriodRange } from "@/lib/period-range-context";
import { formatMonthLabel, nowIST, toMonthKey } from "@/lib/dates";

export const metadata: Metadata = { title: "Billed — Finance & Ledger" };
export const dynamic = "force-dynamic";

// The Ledger Overview's "Billed" drill-down. Not part of the /ledger tab bar
// (LedgerLayout) — reachable only via that card, same as /clients/new isn't
// in the sidebar. Reads the same app-wide period cookies the card does, so
// its rows sum to the exact same total (DevSumAssertion, dev-only).
export default async function LedgerBilledPage() {
  await requireUser("viewer");
  const cookieStore = await cookies();
  const { from: fromMonthKey, to: toMonthKeyValue } = resolvePeriodRange(
    cookieStore.get(PERIOD_FROM_COOKIE)?.value,
    cookieStore.get(PERIOD_TO_COOKIE)?.value,
    toMonthKey(nowIST())
  );

  const [rows, overview] = await Promise.all([
    getBilledClientsForRange(fromMonthKey, toMonthKeyValue),
    getRangeOverview(fromMonthKey, toMonthKeyValue),
  ]);

  const actualPaise = rows.reduce((sum, r) => sum + r.billedPaise, 0);
  const rangeLabel =
    fromMonthKey === toMonthKeyValue
      ? formatMonthLabel(toMonthKeyValue)
      : `${formatMonthLabel(fromMonthKey)} – ${formatMonthLabel(toMonthKeyValue)}`;

  return (
    <div>
      <PageHeader title={`Billed — ${rangeLabel}`} />

      <DevSumAssertion label="Billed" expectedPaise={overview.billedPaise} actualPaise={actualPaise} />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Dues raised in {rangeLabel}</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState title="No dues raised in this period" />
          ) : (
            <div className="grid gap-1">
              {rows.map((row) => (
                <Link
                  key={`${row.clientId}-${row.dueDate}`}
                  href={`/clients/${row.clientId}`}
                  className="flex items-center justify-between rounded-lg px-2 py-2 text-sm hover:bg-muted/40"
                >
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{row.clientName}</p>
                    <StatusBadge status={row.status} />
                  </div>
                  <AmountText paise={row.billedPaise} />
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
