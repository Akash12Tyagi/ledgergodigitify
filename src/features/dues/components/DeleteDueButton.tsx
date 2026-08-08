"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { TypedConfirmDialog } from "@/components/shared/TypedConfirmDialog";
import { formatINR } from "@/lib/money";
import { deleteDueAction } from "@/features/dues/actions";

/**
 * Removes a due raised in error. Typed confirmation plus a mandatory reason,
 * matching how payment reversal is gated — deleting a due erases money the
 * business was owed, so it deserves the same friction.
 *
 * Only offered on dues with no payments against them; the server enforces
 * that too, so the button being visible is never the only thing standing
 * between a receipt and an orphaned reference.
 */
export function DeleteDueButton({
  dueId,
  amountPaise,
  periodLabel,
}: {
  dueId: string;
  amountPaise: number;
  periodLabel: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  async function handleConfirm() {
    if (reason.trim().length < 5) {
      setError("Reason must be at least 5 characters.");
      throw new Error("validation");
    }
    setError(null);
    const result = await deleteDueAction({ dueId, reason: reason.trim() });
    if (!result.success) {
      setError(result.message);
      throw new Error(result.message);
    }
    router.refresh();
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label="Delete due">
        <Trash2 className="size-3.5" /> Delete
      </Button>
      <TypedConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete this due?"
        description={`This removes the ${formatINR(amountPaise)} due for ${periodLabel}. The client will no longer owe it and it will drop out of every total. The audit trail keeps a permanent record of what was deleted and why.`}
        keyword="DELETE"
        confirmLabel="Delete due"
        onConfirm={handleConfirm}
        extraField={
          <div className="grid gap-1.5">
            <Label htmlFor="delete-due-reason">Reason</Label>
            <Textarea
              id="delete-due-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this due being deleted?"
            />
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
        }
      />
    </>
  );
}
