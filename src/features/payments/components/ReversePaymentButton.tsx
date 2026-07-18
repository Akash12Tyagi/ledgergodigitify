"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { TypedConfirmDialog } from "@/components/shared/TypedConfirmDialog";
import { formatINR } from "@/lib/money";
import { reversePaymentAction } from "@/features/payments/actions";

// Section 6.2 / 7.4 — TypedConfirm ("REVERSE") with a reason (5-200
// chars). Placed row-end, never adjacent to the primary Record Payment
// CTA (Section 12 — defensive Fitts for destructive actions).
export function ReversePaymentButton({
  paymentId,
  amountPaise,
  receiptNumber,
}: {
  paymentId: string;
  amountPaise: number;
  receiptNumber: string;
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
    const result = await reversePaymentAction({
      paymentId,
      reason: reason.trim(),
      idempotencyKey: crypto.randomUUID(),
    });
    if (!result.success && result.error.code !== "IDEMPOTENT_REPLAY") {
      setError(result.message);
      throw new Error(result.message);
    }
    router.refresh();
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label="Reverse payment">
        <Undo2 className="size-3.5" /> Reverse
      </Button>
      <TypedConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Reverse this payment?"
        description={`This reverses ${formatINR(amountPaise)} (${receiptNumber}). The receipt stays visible, struck through, with your reason. This cannot be undone — record a fresh payment instead if you need to re-apply it.`}
        keyword="REVERSE"
        confirmLabel="Reverse payment"
        onConfirm={handleConfirm}
        extraField={
          <div className="grid gap-1.5">
            <Label htmlFor="reverse-reason">Reason</Label>
            <Textarea
              id="reverse-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this being reversed?"
            />
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
        }
      />
    </>
  );
}
