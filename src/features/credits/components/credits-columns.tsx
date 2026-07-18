"use client";

import type { ColumnDef } from "@tanstack/react-table";

import { AmountText } from "@/components/shared/AmountText";
import { StatusBadge, type DisplayStatus } from "@/components/shared/StatusBadge";
import { ReverseCreditButton } from "@/features/credits/components/ReverseCreditButton";
import type { CreditRow } from "@/types/credit";
import type { UserRole } from "@/constants/roles";

export function buildCreditsColumns(role: UserRole): ColumnDef<CreditRow, unknown>[] {
  const canReverse = role === "owner" || role === "admin";

  return [
    {
      id: "receivedAt",
      header: "Date",
      cell: ({ row }) =>
        new Date(row.original.receivedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
    },
    { id: "source", header: "Source", cell: ({ row }) => row.original.source },
    { id: "reason", header: "Reason", cell: ({ row }) => row.original.reason },
    {
      id: "category",
      header: "Category",
      cell: ({ row }) => <span className="capitalize">{row.original.category.replace("_", " ")}</span>,
    },
    { id: "account", header: "Account", cell: ({ row }) => row.original.accountName },
    {
      id: "amount",
      header: "Amount",
      cell: ({ row }) => <AmountText paise={row.original.amountPaise} tone="in" />,
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => (
        <StatusBadge status={(row.original.status === "reversed" ? "ARCHIVED" : "ACTIVE") as DisplayStatus} />
      ),
    },
    ...(canReverse
      ? [
          {
            id: "actions",
            header: "",
            cell: ({ row }: { row: { original: CreditRow } }) =>
              row.original.status === "active" ? (
                <ReverseCreditButton creditId={row.original.id} amountPaise={row.original.amountPaise} />
              ) : null,
          } satisfies ColumnDef<CreditRow, unknown>,
        ]
      : []),
  ];
}
