"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { updateUserRoleAction } from "@/features/settings/actions";
import { USER_ROLES, type UserRole } from "@/constants/roles";

export function UserRoleSelect({ userId, role, isSelf }: { userId: string; role: UserRole; isSelf: boolean }) {
  const router = useRouter();
  const [pendingRole, setPendingRole] = React.useState<UserRole | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function commit(next: UserRole) {
    const result = await updateUserRoleAction({ userId, role: next });
    if (!result.success) {
      setError(result.message);
      return;
    }
    router.refresh();
  }

  return (
    <>
      <Select
        value={role}
        onValueChange={(next) => {
          if (!next || next === role) return;
          setPendingRole(next as UserRole);
        }}
        disabled={isSelf}
      >
        <SelectTrigger className="w-28">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {USER_ROLES.map((r) => (
            <SelectItem key={r} value={r} className="capitalize">
              {r}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <ConfirmDialog
        open={pendingRole !== null}
        onOpenChange={(next) => {
          if (!next) setPendingRole(null);
        }}
        title="Change role?"
        description={pendingRole ? `This user will become ${pendingRole} on their next request.` : ""}
        confirmLabel="Change role"
        onConfirm={async () => {
          if (pendingRole) await commit(pendingRole);
        }}
      />
    </>
  );
}
