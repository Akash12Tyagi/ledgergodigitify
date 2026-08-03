import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";

import { PageHeader } from "@/components/shared/PageHeader";
import { AmountText } from "@/components/shared/AmountText";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { DevSumAssertion } from "@/components/shared/DevSumAssertion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getBilledClientsForMonth, getMonthOverview } from "@/server/services/financial-engine";
import { requireUser } from "@/server/auth/guards";
import { MONTH_COOKIE, resolveMonthKey } from "@/lib/month-context";
import { formatMonthLabel, nowIST, toMonthKey } from "@/lib/dates";

export const metadata: Metadata = { title: "Billed — Finance & Ledger" };
export const dynamic = "force-dynamic";

// Section 15/M8 — the Ledger Overview's "Billed" drill-down. Not part of
// the /ledger tab bar (LedgerLayout) — reachable only via that card, same
// as /clients/new isn't in the sidebar. Rows sum to the exact same total
// as the card that links here (DevSumAssertion, dev-only).
export default async function LedgerBilledPage() {
  await requireUser("viewer");
  const cookieStore = await cookies();
  const monthKey = resolveMonthKey(cookieStore.get(MONTH_COOKIE)?.value, toMonthKey(nowIST()));

  const [rows, overview] = await Promise.all([
    getBilledClientsForMonth(monthKey),
    getMonthOverview(monthKey),
  ]);

  const actualPaise = rows.reduce((sum, r) => sum + r.billedPaise, 0);

  return (
    <div>
      <PageHeader title={`Billed — ${formatMonthLabel(monthKey)}`} />

      <DevSumAssertion label="Billed" expectedPaise={overview.billedPaise} actualPaise={actualPaise} />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">
            Clients billed in {formatMonthLabel(monthKey)}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState title="No clients billed this month" />
          ) : (
            <div className="grid gap-1">
              {rows.map((row) => (
                <Link
                  key={row.clientId}
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
