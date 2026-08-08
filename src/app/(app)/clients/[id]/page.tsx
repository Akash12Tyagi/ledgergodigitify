import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { KpiCard } from "@/components/shared/KpiCard";
import { AmountText } from "@/components/shared/AmountText";
import { ClientDetailHeader } from "@/features/clients/components/ClientDetailHeader";
import { ClientDetailTabs } from "@/features/clients/components/ClientDetailTabs";
import { RecordPaymentSheet } from "@/features/payments/components/RecordPaymentSheet";
import { HistoryTab } from "@/features/clients/components/HistoryTab";
import { DuesTab } from "@/features/clients/components/DuesTab";
import { ActivityTab } from "@/features/clients/components/ActivityTab";
import { getClientDetail } from "@/server/services/clients.service";
import { getAccountNamesByIds } from "@/server/services/accounts.service";
import { getEntityAuditLog } from "@/server/services/audit.service";
import { requireUser } from "@/server/auth/guards";
import { formatINR } from "@/lib/money";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const detail = await getClientDetail(id);
  return {
    title: detail ? `${detail.client.name} — Finance & Ledger` : "Client — Finance & Ledger",
  };
}

// Section 7.4 — client detail. ONE composed call (getClientDetail) covering
// every tab, so the header, the Dues tab and the History tab are guaranteed
// to be reading the same numbers.
export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;
  const activeTab = tab ?? "dues";

  const actor = await requireUser("viewer");
  const detail = await getClientDetail(id);
  if (!detail) notFound();

  const { client, summary, duesWithTrails } = detail;
  const { currentDue } = summary;

  const accountIds = [
    ...new Set(duesWithTrails.flatMap((e) => e.trail.map((p) => p.accountId.toString()))),
  ];
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
        totalDuePaise={summary.totalDuePaise}
        role={actor.role}
        showCompletionSuggestion={
          client.engagementType === "one_time" &&
          client.status === "active" &&
          summary.totalDuePaise === 0
        }
        // Shown whenever the client has an outstanding period at all — no
        // longer conditional on there being a billing row for today's
        // calendar month, which is what used to make this button vanish for
        // clients whose cycle didn't align to the 1st.
        recordPaymentSlot={
          currentDue && currentDue.remainingPaise > 0 && client.status !== "archived" ? (
            <RecordPaymentSheet
              clientId={client._id.toString()}
              monthlyBillingId={currentDue.id}
              remainingPaise={currentDue.remainingPaise}
              periodLabel={currentDue.periodLabel}
            />
          ) : null
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          label="Total Due"
          value={
            <AmountText
              paise={summary.totalDuePaise}
              tone={summary.totalDuePaise > 0 ? "out" : "neutral"}
            />
          }
          tone={summary.daysOverdue > 0 ? "warn" : "neutral"}
        />
        <KpiCard
          label="Open Periods"
          value={String(summary.openDues.length)}
          tone={summary.openDues.length > 1 ? "warn" : "neutral"}
        />
        <KpiCard
          label="Next Due Date"
          value={
            summary.nextDueDate
              ? new Date(summary.nextDueDate).toLocaleDateString("en-IN", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                })
              : "—"
          }
        />
        <KpiCard label="Lifetime Paid" value={formatINR(summary.lifetimePaidPaise)} />
      </div>

      <ClientDetailTabs clientId={client._id.toString()} active={activeTab} />

      {activeTab === "dues" ? (
        <DuesTab
          clientId={client._id.toString()}
          clientAmountPaise={client.amountPaise}
          clientArchived={client.status === "archived"}
          entries={duesWithTrails.map((e) => ({ due: e.due, paymentCount: e.trail.length }))}
          role={actor.role}
        />
      ) : null}

      {activeTab === "history" ? (
        <HistoryTab
          entries={duesWithTrails.map((e) => ({
            due: e.due,
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
      ) : null}

      {activeTab === "activity" ? <ActivityTabLoader clientId={client._id.toString()} /> : null}
    </div>
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
