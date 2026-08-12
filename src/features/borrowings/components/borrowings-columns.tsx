"use client";

import type { ColumnDef } from "@tanstack/react-table";

import { AmountText } from "@/components/shared/AmountText";
import { StatusBadge, type DisplayStatus } from "@/components/shared/StatusBadge";
import { RecordRepaymentSheet } from "@/features/borrowings/components/RecordRepaymentSheet";
import { WriteOffBorrowingButton } from "@/features/borrowings/components/WriteOffBorrowingButton";
import type { BorrowingRow } from "@/types/borrowing";
import type { BorrowingStatus } from "@/constants/domain";
import type { UserRole } from "@/constants/roles";

const STATUS_BADGE: Record<BorrowingStatus, DisplayStatus> = {
  open: "OPEN",
  settled: "FULLY_PAID",
  written_off: "CANCELLED",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** Days past the agreed-back date, or null when there was no agreed date or
 * it has not arrived. Overdue is only meaningful while money is still out. */
function daysLate(row: BorrowingRow): number | null {
  if (row.status !== "open" || !row.expectedBackBy) return null;
  const due = new Date(row.expectedBackBy).getTime();
  const diff = Date.now() - due;
  if (diff <= 0) return null;
  return Math.floor(diff / (24 * 60 * 60 * 1000));
}

export function buildBorrowingsColumns(role: UserRole): ColumnDef<BorrowingRow, unknown>[] {
  const canRecord = role !== "viewer";
  const isOwner = role === "owner";

  return [
    {
      id: "borrower",
      header: "Lent to",
      cell: ({ row }) => (
        <div className="grid">
          <span className="font-medium">{row.original.borrowerName}</span>
          {row.original.reason ? (
            <span className="text-xs text-muted-foreground">{row.original.reason}</span>
          ) : null}
        </div>
      ),
    },
    {
      id: "lentAt",
      header: "Lent on",
      cell: ({ row }) => (
        <div className="grid">
          <span>{formatDate(row.original.lentAt)}</span>
          <span className="text-xs text-muted-foreground">{row.original.accountName}</span>
        </div>
      ),
    },
    {
      id: "principal",
      header: "Lent",
      cell: ({ row }) => <AmountText paise={row.original.principalPaise} tone="neutral" />,
    },
    {
      id: "repaid",
      header: "Got back",
      cell: ({ row }) => (
        <div className="grid justify-items-end">
          <AmountText paise={row.original.repaidPaise} tone="in" />
          {row.original.repaymentCount > 0 ? (
            <span className="text-xs text-muted-foreground">
              {row.original.repaymentCount} payment{row.original.repaymentCount === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      id: "outstanding",
      header: "Still owed",
      cell: ({ row }) => (
        <AmountText
          paise={row.original.outstandingPaise}
          // Written off is no longer money you expect, so colouring it as
          // outstanding would keep implying it is coming.
          tone={row.original.status === "open" && row.original.outstandingPaise > 0 ? "out" : "neutral"}
        />
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => {
        const late = daysLate(row.original);
        return (
          <div className="grid justify-items-start gap-0.5">
            <StatusBadge status={STATUS_BADGE[row.original.status]} />
            {late !== null ? (
              <span className="text-xs text-money-out">{late}d overdue</span>
            ) : row.original.status === "open" && row.original.expectedBackBy ? (
              <span className="text-xs text-muted-foreground">
                due {formatDate(row.original.expectedBackBy)}
              </span>
            ) : null}
            {row.original.status === "written_off" && row.original.writtenOffReason ? (
              <span className="text-xs text-muted-foreground">
                {row.original.writtenOffReason}
              </span>
            ) : null}
          </div>
        );
      },
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }: { row: { original: BorrowingRow } }) => {
        if (row.original.status !== "open") return null;
        return (
          <div className="flex items-center justify-end gap-1">
            {isOwner ? (
              <WriteOffBorrowingButton
                borrowingId={row.original.id}
                borrowerName={row.original.borrowerName}
                outstandingPaise={row.original.outstandingPaise}
              />
            ) : null}
            {canRecord ? <RecordRepaymentSheet borrowing={row.original} /> : null}
          </div>
        );
      },
    },
  ];
}
