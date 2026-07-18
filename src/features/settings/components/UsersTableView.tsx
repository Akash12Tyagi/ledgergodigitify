"use client";

import { DataTable } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { CreateUserDialog } from "@/features/settings/components/CreateUserDialog";
import { buildUsersColumns } from "@/features/settings/components/users-columns";
import type { UserRow } from "@/features/settings/actions";

export function UsersTableView({ users, currentUserId }: { users: UserRow[]; currentUserId: string }) {
  return (
    <div className="grid gap-4">
      <div className="flex justify-end">
        <CreateUserDialog />
      </div>
      <DataTable
        columns={buildUsersColumns(currentUserId)}
        data={users}
        total={users.length}
        page={1}
        pageSize={Math.max(users.length, 1)}
        emptyState={<EmptyState title="No users yet" />}
      />
    </div>
  );
}
