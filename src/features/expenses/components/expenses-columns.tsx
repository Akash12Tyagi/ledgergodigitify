"use client";

import type { ColumnDef } from "@tanstack/react-table";

import { AmountText } from "@/components/shared/AmountText";
import { StatusBadge, type DisplayStatus } from "@/components/shared/StatusBadge";
import { ReverseExpenseButton } from "@/features/expenses/components/ReverseExpenseButton";
import { ApproveExpenseButton } from "@/features/expenses/components/ApproveExpenseButton";
import { CancelPendingExpenseButton } from "@/features/expenses/components/CancelPendingExpenseButton";
import { EditPendingExpenseSheet } from "@/features/expenses/components/EditPendingExpenseSheet";
import type { ExpenseRow } from "@/types/expense";
import type { ExpenseStatus } from "@/constants/domain";
import type { UserRole } from "@/constants/roles";

const STATUS_BADGE: Record<ExpenseStatus, DisplayStatus> = {
  pending: "PENDING",
  active: "ACTIVE",
  reversed: "REVERSED",
  cancelled: "CANCELLED",
};

export function buildExpensesColumns(role: UserRole): ColumnDef<ExpenseRow, unknown>[] {
  const isAdmin = role === "owner" || role === "admin";
  const canEdit = isAdmin || role === "staff";

  return [
    {
      id: "spentAt",
      header: "Date",
      cell: ({ row }) => (
        <div className="grid">
          <span>
            {new Date(row.original.spentAt).toLocaleDateString("en-IN", {
              day: "2-digit",
              month: "short",
              year: "numeric",
            })}
          </span>
          {/* On a pending row the date above is only the EXPECTED one, so
              the period it covers is the more meaningful label. */}
          {row.original.periodLabel ? (
            <span className="text-xs text-muted-foreground">{row.original.periodLabel}</span>
          ) : null}
        </div>
      ),
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
      cell: ({ row }) => (
        <AmountText
          paise={row.original.amountPaise}
          // A pending expense has not left the account, so colouring it like
          // money that has would overstate what actually happened.
          tone={row.original.status === "pending" ? "neutral" : "out"}
        />
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <StatusBadge status={STATUS_BADGE[row.original.status]} />
          {row.original.templateId ? (
            <span className="text-xs text-muted-foreground">recurring</span>
          ) : null}
          {row.original.overrideNegativeBalance ? (
            <span className="text-xs text-warn">override</span>
          ) : null}
        </div>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }: { row: { original: ExpenseRow } }) => {
        const expense = row.original;

        if (expense.status === "pending") {
          return (
            <div className="flex items-center justify-end gap-1">
              {canEdit ? <EditPendingExpenseSheet expense={expense} /> : null}
              {isAdmin ? (
                <>
                  <CancelPendingExpenseButton
                    expenseId={expense.id}
                    amountPaise={expense.amountPaise}
                    paidToEntity={expense.paidToEntity}
                  />
                  <ApproveExpenseButton
                    expenseId={expense.id}
                    amountPaise={expense.amountPaise}
                    paidToEntity={expense.paidToEntity}
                    accountName={expense.accountName}
                    role={role}
                  />
                </>
              ) : null}
            </div>
          );
        }

        if (expense.status === "active" && isAdmin) {
          return (
            <div className="flex justify-end">
              <ReverseExpenseButton expenseId={expense.id} amountPaise={expense.amountPaise} />
            </div>
          );
        }

        return null;
      },
    },
  ];
}
