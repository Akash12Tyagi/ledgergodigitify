"use client";

import type { ColumnDef } from "@tanstack/react-table";

import { AmountText } from "@/components/shared/AmountText";
import { StatusBadge, type DisplayStatus } from "@/components/shared/StatusBadge";
import { ReverseExpenseButton } from "@/features/expenses/components/ReverseExpenseButton";
import type { ExpenseRow } from "@/types/expense";
import type { UserRole } from "@/constants/roles";

export function buildExpensesColumns(role: UserRole): ColumnDef<ExpenseRow, unknown>[] {
  const canReverse = role === "owner" || role === "admin";

  return [
    {
      id: "spentAt",
      header: "Date",
      cell: ({ row }) =>
        new Date(row.original.spentAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
    },
    { id: "paidToEntity", header: "Paid to", cell: ({ row }) => row.original.paidToEntity },
    { id: "reason", header: "Reason", cell: ({ row }) => row.original.reason },
    {
      id: "category",
      header: "Category",
      cell: ({ row }) => <span className="capitalize">{row.original.category}</span>,
    },
    { id: "account", header: "Account", cell: ({ row }) => row.original.accountName },
    {
      id: "amount",
      header: "Amount",
      cell: ({ row }) => <AmountText paise={row.original.amountPaise} tone="out" />,
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <StatusBadge status={(row.original.status === "reversed" ? "ARCHIVED" : "ACTIVE") as DisplayStatus} />
          {row.original.overrideNegativeBalance ? (
            <span className="text-xs text-warn">override</span>
          ) : null}
        </div>
      ),
    },
    ...(canReverse
      ? [
          {
            id: "actions",
            header: "",
            cell: ({ row }: { row: { original: ExpenseRow } }) =>
              row.original.status === "active" ? (
                <ReverseExpenseButton expenseId={row.original.id} amountPaise={row.original.amountPaise} />
              ) : null,
          } satisfies ColumnDef<ExpenseRow, unknown>,
        ]
      : []),
  ];
}
