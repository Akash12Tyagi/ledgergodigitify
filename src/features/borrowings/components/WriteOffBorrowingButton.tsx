"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TypedConfirmDialog } from "@/components/shared/TypedConfirmDialog";
import { writeOffBorrowingAction } from "@/features/borrowings/actions";
import { formatINR } from "@/lib/money";

/**
 * Owner-only, and behind a typed keyword — the same bar as reversing a
 * posted entry, because this is the point at which the business stops
 * expecting money back.
 *
 * The copy is explicit that no money moves: the cash left the account the
 * day it was lent, and a write-off only stops the remainder being counted as
 * recoverable. Users reasonably assume "write off" produces a compensating
 * entry somewhere, and it does not.
 */
export function WriteOffBorrowingButton({
  borrowingId,
  borrowerName,
  outstandingPaise,
}: {
  borrowingId: string;
  borrowerName: string;
  outstandingPaise: number;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  async function handleConfirm() {
    if (reason.trim().length < 5) {
      setError("Enter a reason (at least 5 characters).");
      return;
    }
    const result = await writeOffBorrowingAction({ borrowingId, reason: reason.trim() });
    if (!result.success) {
      setError(result.message);
      return;
    }
    router.refresh();
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Write off
      </Button>
      <TypedConfirmDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setReason("");
            setError(null);
          }
        }}
        title="Write off this loan?"
        keyword="WRITE OFF"
        confirmLabel="Write off"
        description={`${formatINR(outstandingPaise)} owed by ${borrowerName} will stop counting as money you expect back. No money moves — it already left when you lent it. The record stays visible.`}
        extraField={
          <div className="grid gap-1.5">
            <Label htmlFor="write-off-reason">Reason</Label>
            <Textarea
              id="write-off-reason"
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
