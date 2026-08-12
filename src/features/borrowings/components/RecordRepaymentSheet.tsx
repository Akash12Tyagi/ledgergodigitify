"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { AccountSelect } from "@/components/shared/AccountSelect";
import { DateFieldIST } from "@/components/shared/DateFieldIST";
import { PAYMENT_METHODS, type PaymentMethod } from "@/constants/domain";
import { formatINR, paiseToRupeesPlain, toPaise } from "@/lib/money";
import { recordRepaymentAction } from "@/features/borrowings/actions";
import type { BorrowingRow } from "@/types/borrowing";

const METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  upi: "UPI",
  bank_transfer: "Bank transfer",
  cheque: "Cheque",
  card: "Card",
  other: "Other",
};

/**
 * "Haan, itna paisa aa gaya" — money coming back from a borrower.
 *
 * Hand-rolled rather than react-hook-form + zodResolver like the bigger
 * sheets: there are five fields, and the one rule that matters (never more
 * than what is outstanding) has to be checked against a prop, which the
 * shared schema cannot see. The server enforces it regardless.
 */
export function RecordRepaymentSheet({ borrowing }: { borrowing: BorrowingRow }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [amountRupees, setAmountRupees] = React.useState("");
  const [receivedAt, setReceivedAt] = React.useState<Date | undefined>(new Date());
  const [accountId, setAccountId] = React.useState("");
  const [method, setMethod] = React.useState<PaymentMethod>("cash");
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function reset() {
    // Prefilled with the full outstanding amount: settling in one go is the
    // common case, and part-payments are a quick edit from there.
    setAmountRupees(paiseToRupeesPlain(borrowing.outstandingPaise));
    setReceivedAt(new Date());
    setAccountId(borrowing.accountId);
    setMethod("cash");
    setNote("");
    setError(null);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    let amountPaise: number;
    try {
      amountPaise = toPaise(amountRupees || "0");
    } catch {
      setError("Enter a valid amount.");
      return;
    }
    if (amountPaise <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }
    if (amountPaise > borrowing.outstandingPaise) {
      setError(`Only ${formatINR(borrowing.outstandingPaise)} is still owed.`);
      return;
    }
    if (!receivedAt) {
      setError("Pick the date the money came in.");
      return;
    }
    if (!accountId) {
      setError("Choose which account received it.");
      return;
    }

    startTransition(async () => {
      const result = await recordRepaymentAction({
        borrowingId: borrowing.id,
        amountPaise,
        receivedAt,
        accountId,
        method,
        note: note.trim() || null,
        idempotencyKey: crypto.randomUUID(),
      });
      if (!result.success) {
        if (result.error.code === "IDEMPOTENT_REPLAY") {
          setOpen(false);
          router.refresh();
          return;
        }
        setError(result.message);
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
        if (next) reset();
      }}
    >
      <SheetTrigger render={<Button size="sm" />}>Got money back</SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Money back from {borrowing.borrowerName}</SheetTitle>
          <SheetDescription>
            {formatINR(borrowing.outstandingPaise)} of {formatINR(borrowing.principalPaise)} is
            still owed.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={submit} className="grid gap-4 px-4" noValidate>
          <div className="grid gap-1.5">
            <Label htmlFor="repayment-amount">Amount received</Label>
            <Input
              id="repayment-amount"
              inputMode="decimal"
              value={amountRupees}
              onChange={(e) => setAmountRupees(e.target.value)}
            />
            {borrowing.outstandingPaise > 0 ? (
              <button
                type="button"
                className="w-fit text-xs text-muted-foreground hover:underline"
                onClick={() => setAmountRupees(paiseToRupeesPlain(borrowing.outstandingPaise))}
              >
                Use full outstanding ({formatINR(borrowing.outstandingPaise)})
              </button>
            ) : null}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="repayment-account">Received into</Label>
            <AccountSelect value={accountId} onChange={setAccountId} />
            <p className="text-xs text-muted-foreground">
              Need not be the account it was lent from.
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="repayment-date">Date received</Label>
            <DateFieldIST value={receivedAt} onChange={setReceivedAt} blockFuture />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="repayment-method">Method</Label>
            <Select value={method} onValueChange={(v) => setMethod((v as PaymentMethod) ?? "cash")}>
              <SelectTrigger className="w-full">
                <SelectValue labels={METHOD_LABELS} />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {METHOD_LABELS[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="repayment-note">Note</Label>
            <Textarea id="repayment-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <SheetFooter className="px-0">
            <Button type="submit" disabled={pending}>
              {pending ? "Recording…" : "Record repayment"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
