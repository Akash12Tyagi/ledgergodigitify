"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { TypedConfirmDialog } from "@/components/shared/TypedConfirmDialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { reverseCreditAction } from "@/features/credits/actions";
import { formatINR } from "@/lib/money";

export function ReverseCreditButton({ creditId, amountPaise }: { creditId: string; amountPaise: number }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  async function handleConfirm() {
    if (reason.trim().length < 5) {
      setError("Enter a reason (at least 5 characters).");
      return;
    }
    const result = await reverseCreditAction({
      creditId,
      reason: reason.trim(),
      idempotencyKey: crypto.randomUUID(),
    });
    if (!result.success) {
      setError(result.message);
      return;
    }
    router.refresh();
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Reverse
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
        title="Reverse this credit?"
        keyword="REVERSE"
        confirmLabel="Reverse"
        description={`This removes ${formatINR(amountPaise)} from the account. The original stays visible, struck through.`}
        extraField={
          <div className="grid gap-1.5">
            <Label htmlFor="reverse-credit-reason">Reason</Label>
            <Textarea id="reverse-credit-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
        }
        onConfirm={handleConfirm}
      />
    </>
  );
}
