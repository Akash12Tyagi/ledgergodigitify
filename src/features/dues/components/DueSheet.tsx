"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { DateFieldIST } from "@/components/shared/DateFieldIST";
import { anchorDayFrom, formatPeriodLabel, periodEndFor } from "@/lib/billing-period";
import { formatINR, paiseToRupeesPlain, toPaise } from "@/lib/money";
import { createDueAction, updateDueAction } from "@/features/dues/actions";
import type { ClientDue } from "@/types/engine";

type DueSheetProps = {
  clientId: string;
  /** Default amount for a new due — the client's agreed rate. */
  defaultAmountPaise: number;
  /** Present in edit mode; absent means "add a new due". */
  due?: ClientDue;
  /**
   * Base UI render prop — the ELEMENT the trigger renders as, for styling
   * only. Pass a self-closing element (`<Button size="sm" />`); the label
   * goes in `triggerLabel`. An element WITH children would render a
   * <button> inside Base UI's own <button>: invalid HTML, failed hydration.
   */
  trigger?: React.ReactElement;
  triggerLabel?: string;
};

/**
 * Add or edit a billing period by hand.
 *
 * The period is entered as an explicit from/to because real engagements do
 * not all run 1st-to-1st. Picking a start date auto-fills the end one month
 * later on the same day-of-month (clamped for short months) and sets the due
 * date to the start — retainers are collected up front — but all three stay
 * independently editable for the cases that don't follow the pattern.
 */
export function DueSheet({
  clientId,
  defaultAmountPaise,
  due,
  trigger,
  triggerLabel,
}: DueSheetProps) {
  const router = useRouter();
  const isEdit = Boolean(due);

  const [open, setOpen] = React.useState(false);
  const [periodStart, setPeriodStart] = React.useState<Date | undefined>(undefined);
  const [periodEnd, setPeriodEnd] = React.useState<Date | undefined>(undefined);
  const [dueDate, setDueDate] = React.useState<Date | undefined>(undefined);
  const [amountRupees, setAmountRupees] = React.useState("");
  const [note, setNote] = React.useState("");
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function resetForOpen() {
    setFormError(null);
    if (due) {
      setPeriodStart(new Date(due.periodStart));
      setPeriodEnd(new Date(due.periodEnd));
      setDueDate(new Date(due.dueDate));
      setAmountRupees(paiseToRupeesPlain(due.billedPaise));
      setNote(due.note ?? "");
    } else {
      setPeriodStart(undefined);
      setPeriodEnd(undefined);
      setDueDate(undefined);
      setAmountRupees(paiseToRupeesPlain(defaultAmountPaise));
      setNote("");
    }
  }

  /** Picking a start proposes the rest of the cycle; the user can override
   * either field afterwards without this stomping on their choice again. */
  function onPeriodStartChange(next: Date | undefined) {
    setPeriodStart(next);
    if (!next) return;
    setPeriodEnd(periodEndFor(next, anchorDayFrom(next)));
    setDueDate(next);
  }

  function submit() {
    setFormError(null);

    if (!periodStart || !periodEnd || !dueDate) {
      setFormError("Period start, period end and due date are all required.");
      return;
    }
    if (periodEnd.getTime() <= periodStart.getTime()) {
      setFormError("Period end must be after period start.");
      return;
    }

    let amountPaise: number;
    try {
      amountPaise = toPaise(amountRupees || "0");
    } catch {
      setFormError("Enter a valid amount.");
      return;
    }
    if (amountPaise <= 0) {
      setFormError("Amount must be more than ₹0.");
      return;
    }

    startTransition(async () => {
      const payload = {
        periodStart,
        periodEnd,
        dueDate,
        amountPaise,
        note: note.trim() ? note.trim() : null,
      };

      const result = due
        ? await updateDueAction({ dueId: due.id, version: due.version, ...payload })
        : await createDueAction({ clientId, ...payload });

      if (!result.success) {
        setFormError(result.message);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  const previewLabel =
    periodStart && periodEnd && periodEnd.getTime() > periodStart.getTime()
      ? formatPeriodLabel(periodStart, periodEnd)
      : null;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) resetForOpen();
      }}
    >
      <SheetTrigger render={trigger ?? <Button variant="outline" />}>
        {triggerLabel ?? "Add Due"}
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{isEdit ? "Edit Due" : "Add Due"}</SheetTitle>
          <SheetDescription>
            {isEdit
              ? "Only a due with no payments recorded against it can be edited."
              : "Raise a billing period for this client."}
          </SheetDescription>
        </SheetHeader>

        <div className="grid gap-4 px-4">
          <div className="grid gap-2">
            <Label>Period from *</Label>
            <DateFieldIST value={periodStart} onChange={onPeriodStartChange} />
          </div>

          <div className="grid gap-2">
            <Label>Period to *</Label>
            <DateFieldIST value={periodEnd} onChange={setPeriodEnd} />
            <p className="text-xs text-muted-foreground">
              Exclusive — the period ends the day before this date.
              {previewLabel ? ` Billing ${previewLabel}.` : ""}
            </p>
          </div>

          <div className="grid gap-2">
            <Label>Due date *</Label>
            <DateFieldIST value={dueDate} onChange={setDueDate} />
            <p className="text-xs text-muted-foreground">
              Defaults to the period start, since retainers are collected up front.
            </p>
          </div>

          <div className="grid gap-2">
            <Label>Amount *</Label>
            <Input
              inputMode="decimal"
              placeholder="₹0"
              value={amountRupees}
              onChange={(e) => setAmountRupees(e.target.value)}
            />
            {!isEdit ? (
              <p className="text-xs text-muted-foreground">
                Client&apos;s agreed rate is {formatINR(defaultAmountPaise)}.
              </p>
            ) : null}
          </div>

          <div className="grid gap-2">
            <Label>Note</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
          </div>

          {formError ? (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          ) : null}
        </div>

        <SheetFooter>
          <Button onClick={submit} disabled={pending}>
            {pending ? "Saving…" : isEdit ? "Save changes" : "Add due"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
