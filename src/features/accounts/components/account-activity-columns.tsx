"use client";

import type { ColumnDef } from "@tanstack/react-table";

import { AmountText } from "@/components/shared/AmountText";
import { StatusBadge, type DisplayStatus } from "@/components/shared/StatusBadge";
import { ReverseTransferButton } from "@/features/accounts/components/ReverseTransferButton";
import { formatINR } from "@/lib/money";
import type { ActivityRow } from "@/types/engine";
import type { UserRole } from "@/constants/roles";

const TYPE_LABELS: Record<ActivityRow["type"], string> = {
  PAYMENT_IN: "Payment",
  CREDIT_IN: "Credit",
  EXPENSE_OUT: "Expense",
  TRANSFER: "Transfer",
  REVERSAL: "Reversal",
  ADJUSTMENT: "Adjustment",
  LOAN_OUT: "Lent",
  LOAN_REPAY_IN: "Loan repaid",
};

// Section 7.8 — /ledger/accounts/[id] activity table columns.
export function buildAccountActivityColumns(role: UserRole): ColumnDef<ActivityRow, unknown>[] {
  const canReverse = role === "owner" || role === "admin";

  return [
    {
      id: "occurredAt",
      header: "Date",
      cell: ({ row }) =>
        new Date(row.original.occurredAt).toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        }),
    },
    {
      id: "type",
      header: "Type",
      cell: ({ row }) => (
        <span>
          {TYPE_LABELS[row.original.type]}
          {row.original.status === "reversed" ? (
            <span className="ml-1 text-muted-foreground line-through">reversed</span>
          ) : null}
        </span>
      ),
    },
    {
      id: "counterparty",
      header: "Counterparty",
      cell: ({ row }) => row.original.counterpartyLabel ?? row.original.note ?? "—",
    },
    {
      id: "amount",
      header: "Amount",
      cell: ({ row }) => (
        <AmountText
          paise={row.original.amountPaise}
          tone={row.original.direction === "IN" ? "in" : "out"}
        />
      ),
    },
    {
      id: "runningBalance",
      header: "Balance",
      cell: ({ row }) => <span className="tabular-nums">{formatINR(row.original.runningBalancePaise)}</span>,
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => (
        <StatusBadge
          status={(row.original.status === "reversed" ? "ARCHIVED" : "ACTIVE") as DisplayStatus}
        />
      ),
    },
    ...(canReverse
      ? [
          {
            id: "actions",
            header: "",
            cell: ({ row }: { row: { original: ActivityRow } }) =>
              row.original.type === "TRANSFER" &&
              row.original.status === "active" &&
              row.original.transactionGroupId ? (
                <ReverseTransferButton
                  transactionGroupId={row.original.transactionGroupId}
                  amountPaise={row.original.amountPaise}
                />
              ) : null,
          } satisfies ColumnDef<ActivityRow, unknown>,
        ]
      : []),
  ];
}
