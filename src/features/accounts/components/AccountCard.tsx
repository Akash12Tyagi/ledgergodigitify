"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Star } from "lucide-react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusBadge, type DisplayStatus } from "@/components/shared/StatusBadge";
import { TypedConfirmDialog } from "@/components/shared/TypedConfirmDialog";
import { EditAccountSheet } from "@/features/accounts/components/EditAccountSheet";
import { archiveAccountAction, setDefaultAccountAction } from "@/features/accounts/actions";
import type { AccountRow } from "@/features/accounts/actions";
import { formatINR } from "@/lib/money";
import type { UserRole } from "@/constants/roles";

export function AccountCard({ account, role }: { account: AccountRow; role: UserRole }) {
  const router = useRouter();
  const [archiveOpen, setArchiveOpen] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const canManage = role === "owner" || role === "admin";
  const isArchived = account.status === "archived";

  async function handleSetDefault() {
    setActionError(null);
    const result = await setDefaultAccountAction(account.id);
    if (!result.success) {
      setActionError(result.message);
      return;
    }
    router.refresh();
  }

  async function handleArchive() {
    setActionError(null);
    const result = await archiveAccountAction(account.id);
    if (!result.success) {
      setActionError(result.message);
      return;
    }
    router.refresh();
  }

  return (
    <Card className={isArchived ? "opacity-60" : undefined}>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <Link href={`/ledger/accounts/${account.id}`} className="font-medium hover:underline">
            {account.name}
          </Link>
          <p className="text-xs text-muted-foreground capitalize">{account.type.replace("_", " ")}</p>
        </div>
        <div className="flex items-center gap-1">
          {account.isDefault ? <Star className="size-4 fill-warn text-warn" /> : null}
          {isArchived ? <StatusBadge status={"ARCHIVED" as DisplayStatus} /> : null}
          {canManage ? (
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="More actions" />}>
                <MoreHorizontal className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem render={<Link href={`/ledger/accounts/${account.id}`} />}>
                  View activity
                </DropdownMenuItem>
                {!isArchived ? (
                  <DropdownMenuItem onClick={() => void handleSetDefault()} disabled={account.isDefault}>
                    Set as default
                  </DropdownMenuItem>
                ) : null}
                {!isArchived ? (
                  <DropdownMenuItem variant="destructive" onClick={() => setArchiveOpen(true)}>
                    Archive
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="grid gap-2">
        <p className="text-2xl font-semibold tabular-nums">{formatINR(account.currentBalancePaise)}</p>
        {account.bankName ? (
          <p className="text-sm text-muted-foreground">
            {account.bankName}
            {account.last4 ? ` •••• ${account.last4}` : ""}
          </p>
        ) : null}
        {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}
        {!isArchived && canManage ? <EditAccountSheet account={account} role={role} /> : null}
      </CardContent>

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
    </Card>
  );
}
