"use client";

import type { ColumnDef } from "@tanstack/react-table";

import { AmountText } from "@/components/shared/AmountText";
import { StatusBadge, type DisplayStatus } from "@/components/shared/StatusBadge";
import { formatINR } from "@/lib/money";
import type { ClientListRow } from "@/types/client";

// Section 7.2 — the /clients table columns.
export const clientsColumns: ColumnDef<ClientListRow, unknown>[] = [
  {
    id: "name",
    header: "Name",
    cell: ({ row }) => (
      <div>
        <div className="font-medium">{row.original.name}</div>
        {row.original.company ? (
          <div className="text-xs text-muted-foreground">{row.original.company}</div>
        ) : null}
      </div>
    ),
  },
  {
    id: "service",
    header: "Service",
    cell: ({ row }) => row.original.service,
  },
  {
    id: "type",
    header: "Type",
    cell: ({ row }) => (
      <span className="text-sm capitalize">{row.original.engagementType.replace("_", " ")}</span>
    ),
  },
  {
    id: "amount",
    header: "Amount",
    cell: ({ row }) => (
      <span className="tabular-nums">
        {formatINR(row.original.amountPaise)}
        {row.original.engagementType === "retainer" ? "/mo" : ""}
      </span>
    ),
  },
  {
    id: "currentPeriod",
    header: "Current Period",
    // `currentStatus === null` means the client genuinely has no due raised
    // yet — shown as its own state rather than as a PENDING badge reading
    // ₹0/₹0, which used to be indistinguishable from an unpaid period.
    cell: ({ row }) =>
      row.original.currentStatus === null ? (
        <span className="text-sm text-muted-foreground">No dues raised</span>
      ) : (
        <div className="grid gap-0.5">
          <StatusBadge
            status={row.original.currentStatus as DisplayStatus}
            suffix={`· ${formatINR(row.original.currentPaidPaise)}/${formatINR(row.original.currentBilledPaise)}`}
          />
          <span className="text-xs text-muted-foreground">{row.original.currentPeriodLabel}</span>
        </div>
      ),
  },
  {
    id: "remainingDue",
    header: "Remaining Due",
    cell: ({ row }) => (
      <div className="grid gap-0.5">
        <AmountText
          paise={row.original.remainingDuePaise}
          tone={row.original.daysOverdue > 0 ? "out" : "neutral"}
        />
        {row.original.openDuesCount > 1 ? (
          <span className="text-xs text-muted-foreground">
            across {row.original.openDuesCount} periods
          </span>
        ) : null}
      </div>
    ),
  },
  {
    id: "nextDue",
    header: "Next Due",
    // Both the date and the overdue count come from the open dues the server
    // already computed. Recomputing them here from the client's stored
    // `nextDueDate` — which never advances after creation — is what made this
    // column contradict the Dues page and keep showing "63 days overdue" for
    // clients who had paid in full.
    cell: ({ row }) => {
      const { nextDueDate, daysOverdue } = row.original;
      if (!nextDueDate) return <span className="text-sm text-muted-foreground">—</span>;
      if (daysOverdue > 0) {
        return (
          <span className="text-money-out">
            {daysOverdue} day{daysOverdue === 1 ? "" : "s"} overdue
          </span>
        );
      }
      return (
        <span>
          {new Date(nextDueDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
        </span>
      );
    },
  },
  {
    id: "lastPayment",
    header: "Last Payment",
    cell: ({ row }) =>
      row.original.lastPaymentAt ? (
        <span className="text-sm">
          {new Date(row.original.lastPaymentAt).toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
          })}{" "}
          · {formatINR(row.original.lastPaymentPaise ?? 0)}
        </span>
      ) : (
        <span className="text-sm text-muted-foreground">—</span>
      ),
  },
];
