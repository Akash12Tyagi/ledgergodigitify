"use client";

import { AccountCard } from "@/features/accounts/components/AccountCard";
import { CreateAccountSheet } from "@/features/accounts/components/CreateAccountSheet";
import { TransferSheet } from "@/features/accounts/components/TransferSheet";
import { EmptyState } from "@/components/shared/EmptyState";
import type { AccountRow } from "@/features/accounts/actions";
import type { UserRole } from "@/constants/roles";

// Section 7.7 — /ledger/accounts. A card grid rather than a data table:
// accounts are few and the balance/quick-actions layout reads better as
// cards than table rows.
export function AccountsPageView({ accounts, role }: { accounts: AccountRow[]; role: UserRole }) {
  const canManage = role === "owner" || role === "admin";

  return (
    <div className="grid gap-4">
      {canManage ? (
        <div className="flex justify-end gap-2">
          <TransferSheet role={role} />
          <CreateAccountSheet />
        </div>
      ) : null}

      {accounts.length === 0 ? (
        <EmptyState
          title="No accounts yet"
          description={canManage ? "Create your first bank, cash, or UPI wallet account." : "Ask an admin to create the first account."}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.map((account) => (
            <AccountCard key={account.id} account={account} role={role} />
          ))}
        </div>
      )}
    </div>
  );
}
