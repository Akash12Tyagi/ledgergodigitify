"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/EmptyState";
import { AmountText } from "@/components/shared/AmountText";
import { TypedConfirmDialog } from "@/components/shared/TypedConfirmDialog";
import { resolveReconciliationAction } from "@/features/settings/actions";

export type LockedAccount = { id: string; name: string; currentBalancePaise: number };

// Section 14 edge case 24 — the owner's resolve step for a reconciliation
// drift lock (Section 6.8D creates the lock; this is the only UI that
// clears it).
export function ReconciliationPanel({ accounts }: { accounts: LockedAccount[] }) {
  const router = useRouter();
  const [target, setTarget] = React.useState<LockedAccount | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function handleResolve() {
    if (!target) return;
    const result = await resolveReconciliationAction(target.id);
    if (!result.success) {
      setError(result.message);
      return;
    }
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Reconciliation</CardTitle>
      </CardHeader>
      <CardContent>
        {accounts.length === 0 ? (
          <EmptyState title="No accounts are locked" description="Every account's ledger matches its balance." />
        ) : (
          <div className="grid gap-2">
            {accounts.map((account) => (
              <div key={account.id} className="flex items-center justify-between rounded-lg border border-money-out/40 bg-money-out/10 p-3">
                <div>
                  <p className="font-medium">{account.name}</p>
                  <p className="text-xs text-muted-foreground">Locked pending reconciliation</p>
                </div>
                <div className="flex items-center gap-3">
                  <AmountText paise={account.currentBalancePaise} />
                  <Button variant="outline" size="sm" onClick={() => setTarget(account)}>
                    Resolve
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
      </CardContent>

      <TypedConfirmDialog
        open={target !== null}
        onOpenChange={(next) => {
          if (!next) setTarget(null);
        }}
        title="Resolve reconciliation lock?"
        keyword="RESOLVE"
        confirmLabel="Resolve"
        description={
          target
            ? `This unlocks "${target.name}" for mutations again. Only do this once you've confirmed the drift is understood and accounted for.`
            : ""
        }
        onConfirm={handleResolve}
      />
    </Card>
  );
}
