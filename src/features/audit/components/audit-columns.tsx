"use client";

import type { ColumnDef } from "@tanstack/react-table";

import { AuditDiffDialog } from "@/features/audit/components/AuditDiffDialog";
import type { AuditLogRow } from "@/types/audit-log";

export const auditColumns: ColumnDef<AuditLogRow, unknown>[] = [
  {
    id: "createdAt",
    header: "When",
    cell: ({ row }) =>
      new Date(row.original.createdAt).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
  },
  { id: "actor", header: "Actor", cell: ({ row }) => row.original.actorName },
  {
    id: "action",
    header: "Action",
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.action}</span>,
  },
  { id: "entity", header: "Entity", cell: ({ row }) => row.original.entityKind },
  { id: "summary", header: "Summary", cell: ({ row }) => row.original.summary },
  {
    id: "diff",
    header: "",
    cell: ({ row }) => <AuditDiffDialog entry={row.original} />,
  },
];
