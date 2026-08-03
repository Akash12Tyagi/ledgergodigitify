"use client";

import type { ColumnDef } from "@tanstack/react-table";

import { StatusBadge, type DisplayStatus } from "@/components/shared/StatusBadge";
import { UserRoleSelect } from "@/features/settings/components/UserRoleSelect";
import { UserActiveAction } from "@/features/settings/components/UserActiveAction";
import type { UserRow } from "@/server/services/settings.service";

export function buildUsersColumns(currentUserId: string): ColumnDef<UserRow, unknown>[] {
  return [
    {
      id: "name",
      header: "Name",
      cell: ({ row }) => (
        <span>
          {row.original.name}
          {row.original.id === currentUserId ? <span className="ml-1 text-xs text-muted-foreground">(you)</span> : null}
        </span>
      ),
    },
    { id: "email", header: "Email", cell: ({ row }) => row.original.email },
    {
      id: "role",
      header: "Role",
      cell: ({ row }) => (
        <UserRoleSelect
          userId={row.original.id}
          role={row.original.role}
          isSelf={row.original.id === currentUserId}
        />
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => (
        <StatusBadge status={(row.original.isActive ? "ACTIVE" : "ARCHIVED") as DisplayStatus} />
      ),
    },
    {
      id: "lastLoginAt",
      header: "Last Login",
      cell: ({ row }) =>
        row.original.lastLoginAt
          ? new Date(row.original.lastLoginAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
          : "—",
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <UserActiveAction
          userId={row.original.id}
          isActive={row.original.isActive}
          isSelf={row.original.id === currentUserId}
          name={row.original.name}
        />
      ),
    },
  ];
}
