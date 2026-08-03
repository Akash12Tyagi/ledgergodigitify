import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { KpiCard } from "@/components/shared/KpiCard";
import { AmountText } from "@/components/shared/AmountText";
import { ClientDetailHeader } from "@/features/clients/components/ClientDetailHeader";
import { ClientDetailTabs } from "@/features/clients/components/ClientDetailTabs";
import { PaymentTrail } from "@/features/payments/components/PaymentTrail";
import { RecordPaymentSheet } from "@/features/payments/components/RecordPaymentSheet";
import { HistoryTab } from "@/features/clients/components/HistoryTab";
import { DuesTab } from "@/features/clients/components/DuesTab";
import { ActivityTab } from "@/features/clients/components/ActivityTab";
import { getClientDetail, getClientHistoryWithTrails } from "@/server/services/clients.service";
import { getAccountNamesByIds } from "@/server/services/accounts.service";
import { getEntityAuditLog } from "@/server/services/audit.service";
import { requireUser } from "@/server/auth/guards";
import { toMonthKey, nowIST } from "@/lib/dates";
import { formatINR } from "@/lib/money";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const detail = await getClientDetail(id, toMonthKey(nowIST()));
  return { title: detail ? `${detail.client.name} — Finance & Ledger` : "Client — Finance & Ledger" };
}

// Section 7.4 — client detail. ONE composed call (getClientDetail) plus
// tab-specific data fetched only when that tab is active.
export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;
  const activeTab = tab ?? "current";

  const actor = await requireUser("viewer");
  const monthKey = toMonthKey(nowIST());
  const detail = await getClientDetail(id, monthKey);
  if (!detail) notFound();

  const { client, monthStatus, totalDue, lifetimePaid, history, currentBilling, trail } = detail;

  const accountIds = [...new Set(trail.map((p) => p.accountId.toString()))];
  const accountNameById = await getAccountNamesByIds(accountIds);

  return (
    <div>
      <ClientDetailHeader
        client={{
          id: client._id.toString(),
          name: client.name,
          service: client.service,
          engagementType: client.engagementType,
          status: client.status,
          amountPaise: client.amountPaise,
          nextDueDate: client.nextDueDate.toISOString(),
          email: client.email ?? null,
          phone: client.phone ?? null,
          company: client.company ?? null,
          address: client.address ?? null,
          gstin: client.gstin ?? null,
          notes: client.notes ?? null,
          version: client.version,
        }}
        totalDuePaise={totalDue}
        role={actor.role}
        showCompletionSuggestion={
          client.engagementType === "one_time" && client.status === "active" && totalDue === 0
        }
        recordPaymentSlot={
          currentBilling ? (
            <RecordPaymentSheet
              clientId={client._id.toString()}
              monthlyBillingId={currentBilling._id.toString()}
              remainingPaise={monthStatus.remainingPaise}
              monthLabel={monthKey}
            />
          ) : null
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          label="Total Due"
          value={<AmountText paise={totalDue} tone={totalDue > 0 ? "out" : "neutral"} />}
          tone={monthStatus.daysOverdue > 0 ? "warn" : "neutral"}
        />
        <KpiCard
          label="This Month"
          value={<AmountText paise={monthStatus.remainingPaise} />}
        />
        <KpiCard
          label="Next Due Date"
          value={new Date(client.nextDueDate).toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          })}
        />
        <KpiCard label="Lifetime Paid" value={formatINR(lifetimePaid)} />
      </div>

      <ClientDetailTabs clientId={client._id.toString()} active={activeTab} />

      {activeTab === "current" ? (
        <div>
          <h2 className="mb-3 text-lg font-semibold">{monthKey}</h2>
          <PaymentTrail
            payments={trail.map((p) => ({
              id: p._id.toString(),
              amountPaise: p.amountPaise,
              paidAt: p.paidAt.toISOString(),
              method: p.method,
              receiptNumber: p.receiptNumber,
              accountName: accountNameById.get(p.accountId.toString()) ?? "—",
              status: p.status,
              reversedReason: p.reversedReason ?? null,
            }))}
            billedPaise={monthStatus.billedPaise}
            carriedInPaise={monthStatus.carriedInPaise}
            paidPaise={monthStatus.paidPaise}
            remainingPaise={monthStatus.remainingPaise}
            status={monthStatus.status}
            role={actor.role}
          />
        </div>
      ) : null}

      {activeTab === "history" ? (
        <HistoryTabLoader clientId={client._id.toString()} />
      ) : null}

      {activeTab === "dues" ? <DuesTab history={history} /> : null}

      {activeTab === "activity" ? (
        <ActivityTabLoader clientId={client._id.toString()} />
      ) : null}
    </div>
  );
}

async function HistoryTabLoader({ clientId }: { clientId: string }) {
  const entries = await getClientHistoryWithTrails(clientId);
  const accountIds = [
    ...new Set(entries.flatMap((e) => e.trail.map((p) => p.accountId.toString()))),
  ];
  const accountNameById = await getAccountNamesByIds(accountIds);
  return (
    <HistoryTab
      entries={entries.map((e) => ({
        monthStatus: e.monthStatus,
        trail: e.trail.map((p) => ({
          _id: p._id,
          amountPaise: p.amountPaise,
          paidAt: p.paidAt,
          method: p.method,
          invoiceNumber: p.invoiceNumber,
          receiptNumber: p.receiptNumber,
          accountId: p.accountId,
          status: p.status,
        })),
      }))}
      accountNameById={accountNameById}
    />
  );
}

async function ActivityTabLoader({ clientId }: { clientId: string }) {
  const entries = await getEntityAuditLog("client", clientId);
  return (
    <ActivityTab
      entries={entries.map((e) => ({
        _id: e._id.toString(),
        action: e.action,
        summary: e.summary,
        actorName: e.actorName,
        createdAt: e.createdAt,
      }))}
    />
  );
}
