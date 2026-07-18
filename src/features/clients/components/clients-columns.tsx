"use client";

import type { ColumnDef } from "@tanstack/react-table";

import { AmountText } from "@/components/shared/AmountText";
import { StatusBadge, type DisplayStatus } from "@/components/shared/StatusBadge";
import { formatINR } from "@/lib/money";
import { daysOverdue as computeDaysOverdue } from "@/lib/dates";
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
    id: "thisMonth",
    header: "This Month",
    cell: ({ row }) => (
      <StatusBadge
        status={row.original.thisMonthStatus as DisplayStatus}
        suffix={`· ${formatINR(row.original.thisMonthPaidPaise)}/${formatINR(row.original.thisMonthBilledPaise)}`}
      />
    ),
  },
  {
    id: "remainingDue",
    header: "Remaining Due",
    cell: ({ row }) => (
      <AmountText
        paise={row.original.remainingDuePaise}
        tone={row.original.daysOverdue > 0 ? "out" : "neutral"}
      />
    ),
  },
  {
    id: "nextDue",
    header: "Next Due",
    cell: ({ row }) => {
      const overdue = computeDaysOverdue(new Date(row.original.nextDueDate));
      const dueDateLabel = new Date(row.original.nextDueDate).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
      });
      return overdue > 0 ? (
        <span className="text-money-out">
          {overdue} day{overdue === 1 ? "" : "s"} overdue
        </span>
      ) : (
        <span>{dueDateLabel}</span>
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
