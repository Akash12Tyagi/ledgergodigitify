"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { DateFieldIST } from "@/components/shared/DateFieldIST";
import { formatINR, toPaise } from "@/lib/money";
import { adjustAccountAction } from "@/features/accounts/actions";

const DIRECTION_LABELS: Record<"IN" | "OUT", string> = {
  IN: "Add to balance (money in)",
  OUT: "Reduce balance (money out)",
};

/**
 * Correct an account's balance without rewriting history.
 *
 * The form asks for a direction and an amount rather than a new balance,
 * because the delta is what actually gets recorded — a dated transaction in
 * the account's own activity, carrying the reason and the author. The
 * resulting balance is previewed live so the operator can still think in
 * terms of "make it read ₹X".
 */
export function AdjustBalanceSheet({
  accountId,
  accountName,
  currentBalancePaise,
  trigger,
  triggerLabel,
}: {
  accountId: string;
  accountName: string;
  currentBalancePaise: number;
  /**
   * Base UI render prop — the ELEMENT the trigger renders as, for styling
   * only. Pass a self-closing element; the label goes in `triggerLabel`.
   * An element WITH children nests a <button> inside Base UI's own
   * <button>: invalid HTML, failed hydration.
   */
  trigger?: React.ReactElement;
  triggerLabel?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [direction, setDirection] = React.useState<"IN" | "OUT">("IN");
  const [amountRupees, setAmountRupees] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [occurredAt, setOccurredAt] = React.useState<Date | undefined>(() => new Date());
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function resetForOpen() {
    setDirection("IN");
    setAmountRupees("");
    setReason("");
    setOccurredAt(new Date());
    setFormError(null);
  }

  let parsedPaise = 0;
  try {
    parsedPaise = amountRupees.trim() ? toPaise(amountRupees) : 0;
  } catch {
    parsedPaise = 0;
  }
  const projectedBalance =
    currentBalancePaise + (direction === "IN" ? parsedPaise : -parsedPaise);

  function submit() {
    setFormError(null);

    if (!occurredAt) {
      setFormError("Pick a date for this adjustment.");
      return;
    }
    if (parsedPaise <= 0) {
      setFormError("Enter an amount greater than ₹0.");
      return;
    }
    if (reason.trim().length < 5) {
      setFormError("Reason must be at least 5 characters.");
      return;
    }

    startTransition(async () => {
      const result = await adjustAccountAction({
        accountId,
        direction,
        amountPaise: parsedPaise,
        reason: reason.trim(),
        occurredAt,
        idempotencyKey: crypto.randomUUID(),
      });

      if (!result.success && result.error.code !== "IDEMPOTENT_REPLAY") {
        setFormError(result.message);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) resetForOpen();
      }}
    >
      <SheetTrigger render={trigger ?? <Button variant="outline" />}>
        {triggerLabel ?? "Adjust Balance"}
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Adjust Balance</SheetTitle>
          <SheetDescription>
            {accountName} · currently {formatINR(currentBalancePaise)}
          </SheetDescription>
        </SheetHeader>

        <div className="grid gap-4 px-4">
          <div className="grid gap-2">
            <Label>Direction *</Label>
            <Select value={direction} onValueChange={(v) => setDirection(v as "IN" | "OUT")}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: string | null) => DIRECTION_LABELS[v as "IN" | "OUT"] ?? "Select"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(["IN", "OUT"] as const).map((d) => (
                  <SelectItem key={d} value={d}>
                    {DIRECTION_LABELS[d]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label>Amount *</Label>
            <Input
              inputMode="decimal"
              placeholder="₹0"
              value={amountRupees}
              onChange={(e) => setAmountRupees(e.target.value)}
            />
            {parsedPaise > 0 ? (
              <p className="text-xs text-muted-foreground">
                New balance will be {formatINR(projectedBalance)}.
                {projectedBalance < 0 ? " This account will go negative." : ""}
              </p>
            ) : null}
          </div>

          <div className="grid gap-2">
            <Label>Date *</Label>
            <DateFieldIST value={occurredAt} onChange={setOccurredAt} blockFuture />
          </div>

          <div className="grid gap-2">
            <Label>Reason *</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Cash count short by ₹500, bank charge not recorded"
            />
            <p className="text-xs text-muted-foreground">
              Recorded permanently in this account&apos;s activity and the audit trail.
            </p>
          </div>

          {formError ? (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          ) : null}
        </div>

        <SheetFooter>
          <Button onClick={submit} disabled={pending}>
            {pending ? "Recording…" : "Record adjustment"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
