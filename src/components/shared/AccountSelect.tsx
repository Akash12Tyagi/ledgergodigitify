"use client";

import * as React from "react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatINR } from "@/lib/money";
import { listActiveAccountsAction, type AccountOption } from "@/features/accounts/actions";

/**
 * Section 7.4/7.6 — "Account (AccountSelect, default = isDefault account;
 * if zero accounts exist → inline card 'You need an account first')".
 * The create-account-inline-modal half of that spec lands with account
 * management in Milestone 4; until then, a zero-accounts state shows a
 * plain message instead of a non-functional "Create account" button.
 */
export function AccountSelect({
  value,
  onChange,
  disabled,
}: {
  value?: string;
  onChange: (accountId: string) => void;
  disabled?: boolean;
}) {
  const [accounts, setAccounts] = React.useState<AccountOption[] | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    listActiveAccountsAction().then((result) => {
      if (cancelled) return;
      if (result.success) {
        setAccounts(result.data);
        if (!value) {
          const defaultAccount = result.data.find((a) => a.isDefault) ?? result.data[0];
          if (defaultAccount) onChange(defaultAccount.id);
        }
      } else {
        setAccounts([]);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetch once on mount
  }, []);

  if (accounts === null) {
    return <div className="h-8 animate-pulse rounded-lg bg-muted" />;
  }

  if (accounts.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
        You need an account first. Create one in Ledger → Accounts, then come back.
      </p>
    );
  }

  return (
    <Select value={value} onValueChange={(next) => onChange(next ?? "")} disabled={disabled}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Select an account" />
      </SelectTrigger>
      <SelectContent>
        {accounts.map((account) => (
          <SelectItem key={account.id} value={account.id}>
            {account.name} — {formatINR(account.currentBalancePaise)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
