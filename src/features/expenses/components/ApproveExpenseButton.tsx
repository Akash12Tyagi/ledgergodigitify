"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { DateFieldIST } from "@/components/shared/DateFieldIST";
import { approveExpenseAction } from "@/features/expenses/actions";
import { formatINR } from "@/lib/money";
import type { UserRole } from "@/constants/roles";

/**
 * Section 6.3.3 — the step that turns a pending expense into money.
 *
 * The date defaults to TODAY rather than the pending row's own `spentAt`,
 * because that date is only ever the period's expected one: August's salary
 * is raised dated 1 Aug but may well be paid on the 3rd, and the ledger has
 * to record the day the balance actually changed.
 */
export function ApproveExpenseButton({
  expenseId,
  amountPaise,
  paidToEntity,
  accountName,
  role,
}: {
  expenseId: string;
  amountPaise: number;
  paidToEntity: string;
  accountName: string;
  role: UserRole;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [spentAt, setSpentAt] = React.useState<Date | undefined>(new Date());
  const [override, setOverride] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function reset() {
    setSpentAt(new Date());
    setOverride(false);
    setError(null);
  }

  /** Returning false keeps the dialog open so the message stays visible. */
  async function handleConfirm(): Promise<boolean> {
    if (!spentAt) {
      setError("Pick the date the money actually went out.");
      return false;
    }
    setError(null);
    const result = await approveExpenseAction({
      expenseId,
      spentAt,
      overrideNegativeBalance: override,
      idempotencyKey: crypto.randomUUID(),
    });
    if (!result.success) {
      // A replay means someone already approved this — the end state is
      // what the user wanted either way, so refresh rather than alarm them.
      if (result.error.code === "IDEMPOTENT_REPLAY") {
        router.refresh();
        return true;
      }
      setError(result.message);
      return false;
    }
    router.refresh();
    return true;
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Approve
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) reset();
        }}
        title="Approve this expense?"
        confirmLabel="Approve & deduct"
        description={`${formatINR(amountPaise)} to ${paidToEntity} will be deducted from ${accountName}. This posts to the ledger and cannot be edited afterwards — only reversed.`}
        extraField={
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="approve-expense-date">Date paid</Label>
              <DateFieldIST value={spentAt} onChange={setSpentAt} blockFuture />
            </div>
            {role === "owner" ? (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="approve-expense-override"
                  checked={override}
                  onCheckedChange={(v) => setOverride(v === true)}
                />
                <Label htmlFor="approve-expense-override" className="mt-0!">
                  Allow this to push the account negative
                </Label>
              </div>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        }
        onConfirm={handleConfirm}
      />
    </>
  );
}
