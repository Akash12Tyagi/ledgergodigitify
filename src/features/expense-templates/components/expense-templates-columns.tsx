"use client";

import type { ColumnDef } from "@tanstack/react-table";

import { AmountText } from "@/components/shared/AmountText";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { EditExpenseTemplateSheet } from "@/features/expense-templates/components/EditExpenseTemplateSheet";
import { PauseResumeTemplateButton } from "@/features/expense-templates/components/PauseResumeTemplateButton";
import type { ExpenseTemplateRow } from "@/types/expense";
import type { UserRole } from "@/constants/roles";

/** "3rd", "21st" — the anchor day reads as a date, not a bare number. */
function ordinal(day: number): string {
  const remainderTen = day % 10;
  const remainderHundred = day % 100;
  if (remainderTen === 1 && remainderHundred !== 11) return `${day}st`;
  if (remainderTen === 2 && remainderHundred !== 12) return `${day}nd`;
  if (remainderTen === 3 && remainderHundred !== 13) return `${day}rd`;
  return `${day}th`;
}

export function buildExpenseTemplatesColumns(
  role: UserRole
): ColumnDef<ExpenseTemplateRow, unknown>[] {
  const isAdmin = role === "owner" || role === "admin";

  return [
    { id: "paidToEntity", header: "Paid to", cell: ({ row }) => row.original.paidToEntity },
    { id: "reason", header: "Reason", cell: ({ row }) => row.original.reason },
    {
      id: "category",
      header: "Category",
      cell: ({ row }) => <span className="capitalize">{row.original.category}</span>,
    },
    { id: "account", header: "Pay from", cell: ({ row }) => row.original.accountName },
    {
      id: "amount",
      header: "Amount",
      cell: ({ row }) => <AmountText paise={row.original.amountPaise} tone="neutral" />,
    },
    {
      id: "schedule",
      header: "Repeats",
      cell: ({ row }) => (
        <span className="whitespace-nowrap">
          {ordinal(row.original.billingDay)} of each month
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <StatusBadge status={row.original.status === "paused" ? "PAUSED" : "ACTIVE"} />
          {row.original.status === "paused" && row.original.pausedReason ? (
            <span className="text-xs text-muted-foreground">{row.original.pausedReason}</span>
          ) : null}
        </div>
      ),
    },
    ...(isAdmin
      ? [
          {
            id: "actions",
            header: "",
            cell: ({ row }: { row: { original: ExpenseTemplateRow } }) => (
              <div className="flex items-center justify-end gap-1">
                <EditExpenseTemplateSheet template={row.original} />
                <PauseResumeTemplateButton
                  templateId={row.original.id}
                  status={row.original.status}
                  paidToEntity={row.original.paidToEntity}
                />
              </div>
            ),
          } satisfies ColumnDef<ExpenseTemplateRow, unknown>,
        ]
      : []),
  ];
}
