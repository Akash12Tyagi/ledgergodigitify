"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { cancelPendingExpenseAction } from "@/features/expenses/actions";
import { formatINR } from "@/lib/money";

/**
 * Dismisses a pending expense that should not be paid — a rent period after
 * the office moved, a salary for someone who left.
 *
 * No type-to-confirm keyword here, unlike Reverse: nothing has posted, so
 * the worst case is re-creating a row, not unwinding money. The row is kept
 * as `cancelled` rather than deleted, which the description says out loud so
 * nobody expects it to vanish from history.
 */
export function CancelPendingExpenseButton({
  expenseId,
  amountPaise,
  paidToEntity,
}: {
  expenseId: string;
  amountPaise: number;
  paidToEntity: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  async function handleConfirm(): Promise<boolean> {
    if (reason.trim().length < 2) {
      setError("Enter a reason.");
      return false;
    }
    setError(null);
    const result = await cancelPendingExpenseAction({ expenseId, reason: reason.trim() });
    if (!result.success) {
      setError(result.message);
      return false;
    }
    router.refresh();
    return true;
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Cancel
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setReason("");
            setError(null);
          }
        }}
        destructive
        title="Cancel this pending expense?"
        confirmLabel="Cancel expense"
        cancelLabel="Keep it"
        description={`${formatINR(amountPaise)} to ${paidToEntity} will not be paid. No money moves — the row stays in history marked cancelled.`}
        extraField={
          <div className="grid gap-1.5">
            <Label htmlFor="cancel-expense-reason">Reason</Label>
            <Textarea
              id="cancel-expense-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
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
