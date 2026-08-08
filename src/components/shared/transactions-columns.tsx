"use client";

import type { ColumnDef } from "@tanstack/react-table";

import { AmountText } from "@/components/shared/AmountText";
import { StatusBadge, type DisplayStatus } from "@/components/shared/StatusBadge";
import type { TxRow } from "@/types/engine";

const TYPE_LABELS: Record<TxRow["type"], string> = {
  PAYMENT_IN: "Payment",
  CREDIT_IN: "Credit",
  EXPENSE_OUT: "Expense",
  TRANSFER: "Transfer",
  REVERSAL: "Reversal",
  ADJUSTMENT: "Adjustment",
};

// Section 4.6/7.5 — /ledger/overview's sibling-list columns. Read-only:
// reversal actions live on each entity's owning list (/ledger/expenses,
// /ledger/credits, /ledger/accounts/[id]), not duplicated here.
export const transactionsColumns: ColumnDef<TxRow, unknown>[] = [
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
    cell: ({ row }) => TYPE_LABELS[row.original.type],
  },
  {
    id: "counterparty",
    header: "Counterparty",
    cell: ({ row }) => row.original.counterpartyLabel ?? row.original.note ?? "—",
  },
  {
    id: "account",
    header: "Account",
    cell: ({ row }) => row.original.accountName,
  },
  {
    id: "amount",
    header: "Amount",
    cell: ({ row }) => (
      <AmountText paise={row.original.amountPaise} tone={row.original.direction === "IN" ? "in" : "out"} />
    ),
  },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) => (
      <StatusBadge status={(row.original.status === "reversed" ? "ARCHIVED" : "ACTIVE") as DisplayStatus} />
    ),
  },
];
