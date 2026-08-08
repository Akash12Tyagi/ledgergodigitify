"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";

import { StatusBadge, type DisplayStatus } from "@/components/shared/StatusBadge";
import { TypedConfirmDialog } from "@/components/shared/TypedConfirmDialog";
import { Button } from "@/components/ui/button";
import { EditAccountSheet } from "@/features/accounts/components/EditAccountSheet";
import { AdjustBalanceSheet } from "@/features/accounts/components/AdjustBalanceSheet";
import { archiveAccountAction, setDefaultAccountAction } from "@/features/accounts/actions";
import type { AccountRow } from "@/features/accounts/actions";
import { formatINR } from "@/lib/money";
import type { UserRole } from "@/constants/roles";

// Section 7.8 — /ledger/accounts/[id] header.
export function AccountDetailHeader({ account, role }: { account: AccountRow; role: UserRole }) {
  const router = useRouter();
  const [archiveOpen, setArchiveOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const canManage = role === "owner" || role === "admin";
  const isArchived = account.status === "archived";

  async function handleSetDefault() {
    setError(null);
    const result = await setDefaultAccountAction(account.id);
    if (!result.success) {
      setError(result.message);
      return;
    }
    router.refresh();
  }

  async function handleArchive() {
    setError(null);
    const result = await archiveAccountAction(account.id);
    if (!result.success) {
      setError(result.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="mb-6 grid gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="grid gap-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">{account.name}</h1>
            {account.isDefault ? <Star className="size-4 fill-warn text-warn" /> : null}
            {isArchived ? <StatusBadge status={"ARCHIVED" as DisplayStatus} /> : null}
          </div>
          <p className="text-sm text-muted-foreground capitalize">
            {account.type.replace("_", " ")}
            {account.bankName ? ` · ${account.bankName}${account.last4 ? ` •••• ${account.last4}` : ""}` : ""}
          </p>
        </div>
        <p className="text-3xl font-semibold tabular-nums">{formatINR(account.currentBalancePaise)}</p>
      </div>

      {canManage && !isArchived ? (
        <div className="flex items-center gap-2">
          <EditAccountSheet account={account} role={role} />
          <AdjustBalanceSheet
            accountId={account.id}
            accountName={account.name}
            currentBalancePaise={account.currentBalancePaise}
            trigger={<Button variant="outline" size="sm" />}
            triggerLabel="Adjust Balance"
          />
          {!account.isDefault ? (
            <Button variant="outline" size="sm" onClick={() => void handleSetDefault()}>
              Set as default
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => setArchiveOpen(true)}>
            Archive
          </Button>
        </div>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <TypedConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title="Archive this account?"
        keyword="ARCHIVE"
        confirmLabel="Archive"
        description={
          account.currentBalancePaise !== 0
            ? `${account.name} still holds ${formatINR(account.currentBalancePaise)}. Transfer it out before archiving.`
            : `${account.name} has a zero balance and can be archived. It disappears from account pickers but stays visible in history.`
        }
        onConfirm={handleArchive}
      />
    </div>
  );
}
