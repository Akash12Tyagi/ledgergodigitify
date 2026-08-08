"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { AccountSelect } from "@/components/shared/AccountSelect";
import { DateFieldIST } from "@/components/shared/DateFieldIST";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { recordPaymentSchema, type RecordPaymentInput } from "@/schemas/payment.schema";
import { formatINR, paiseToRupeesPlain, toPaise } from "@/lib/money";
import { LARGE_ENTRY_CONFIRM_PAISE } from "@/constants/finance";
import { PAYMENT_METHODS } from "@/constants/domain";
import { recordPaymentAction } from "@/features/payments/actions";
import type { PayStatus } from "@/constants/domain";

type RecordPaymentSheetProps = {
  clientId: string;
  monthlyBillingId: string;
  remainingPaise: number;
  periodLabel: string;
  /**
   * Base UI render prop — the ELEMENT the trigger is rendered as, for
   * styling only. Pass a self-closing element (`<Button size="sm" />`); its
   * children are ignored, so the label goes in `triggerLabel`.
   *
   * Passing an element WITH children here renders a <button> inside Base
   * UI's own <button>, which is invalid HTML and fails hydration.
   */
  trigger?: React.ReactElement;
  triggerLabel?: string;
};

type FormValues = Omit<RecordPaymentInput, "paidAt"> & { paidAt: Date | undefined };

const METHOD_LABELS: Record<(typeof PAYMENT_METHODS)[number], string> = {
  cash: "Cash",
  upi: "UPI",
  bank_transfer: "Bank Transfer",
  cheque: "Cheque",
  card: "Card",
  other: "Other",
};

// Section 7.4 — Record Payment sheet. Amount defaults to the remaining
// balance; going over it is allowed (OVERPAID) with an inline note, not a
// block. Success renders INSIDE the sheet (no optimistic money, Section
// 7.4) with [Done] / [Record another].
export function RecordPaymentSheet({
  clientId,
  monthlyBillingId,
  remainingPaise,
  periodLabel,
  trigger,
  triggerLabel,
}: RecordPaymentSheetProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [amountRupees, setAmountRupees] = React.useState(() => paiseToRupeesPlain(remainingPaise));
  const [largeConfirmOpen, setLargeConfirmOpen] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [success, setSuccess] = React.useState<{
    receiptNumber: string;
    amountPaise: number;
    newBillingStatus: PayStatus;
    accountNewBalance: number;
  } | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(recordPaymentSchema) as never,
    defaultValues: {
      clientId,
      monthlyBillingId,
      amountPaise: remainingPaise,
      accountId: "",
      paidAt: new Date(),
      method: "upi",
      invoiceNumber: "",
      receiptNumber: "",
      reference: null,
      note: null,
      idempotencyKey: crypto.randomUUID(),
    },
  });

  function resetForSheetOpen() {
    setSuccess(null);
    setFormError(null);
    setAmountRupees(paiseToRupeesPlain(remainingPaise));
    form.reset({
      clientId,
      monthlyBillingId,
      amountPaise: remainingPaise,
      accountId: form.getValues("accountId"),
      paidAt: new Date(),
      method: "upi",
      invoiceNumber: "",
      receiptNumber: "",
      reference: null,
      note: null,
      idempotencyKey: crypto.randomUUID(),
    });
  }

  function submit(values: FormValues) {
    if (!values.paidAt) return;
    if (values.amountPaise >= LARGE_ENTRY_CONFIRM_PAISE && !largeConfirmOpen) {
      setLargeConfirmOpen(true);
      return;
    }
    doSubmit(values as RecordPaymentInput);
  }

  function doSubmit(values: RecordPaymentInput) {
    setFormError(null);
    startTransition(async () => {
      const result = await recordPaymentAction(values);
      if (!result.success) {
        if (result.error.code === "IDEMPOTENT_REPLAY") {
          // Treated as success (Section 8.1) — the original result is
          // already reflected server-side; just close cleanly.
          setOpen(false);
          router.refresh();
          return;
        }
        if (result.error.fields?.invoiceNumber) {
          form.setError("invoiceNumber", { message: result.error.fields.invoiceNumber });
        }
        if (result.error.fields?.receiptNumber) {
          form.setError("receiptNumber", { message: result.error.fields.receiptNumber });
        }
        setFormError(result.message);
        return;
      }
      setSuccess({
        receiptNumber: result.data.receiptNumber,
        amountPaise: values.amountPaise,
        newBillingStatus: result.data.newBillingStatus,
        accountNewBalance: result.data.accountNewBalance,
      });
      router.refresh();
    });
  }

  const overRemaining = form.watch("amountPaise") > remainingPaise;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) resetForSheetOpen();
      }}
    >
      <SheetTrigger render={trigger ?? <Button />}>
        {triggerLabel ?? "Record Payment"}
      </SheetTrigger>
      <SheetContent>
        {success ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
            <CheckCircle2 className="size-12 text-money-in" />
            <p className="text-xl font-semibold">{formatINR(success.amountPaise)} recorded</p>
            <p className="text-sm text-muted-foreground">Receipt {success.receiptNumber}</p>
            <p className="text-sm">New account balance: {formatINR(success.accountNewBalance)}</p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Done
              </Button>
              <Button onClick={resetForSheetOpen}>Record another</Button>
            </div>
          </div>
        ) : (
          <>
            <SheetHeader>
              <SheetTitle>Record Payment</SheetTitle>
              <SheetDescription>{periodLabel}</SheetDescription>
            </SheetHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(submit)} className="grid gap-4 px-4" noValidate>
                <FormField
                  control={form.control}
                  name="amountPaise"
                  render={() => (
                    <FormItem>
                      <FormLabel>Amount</FormLabel>
                      <FormControl>
                        <Input
                          inputMode="decimal"
                          value={amountRupees}
                          onChange={(e) => setAmountRupees(e.target.value)}
                          onBlur={() => {
                            try {
                              form.setValue("amountPaise", toPaise(amountRupees || "0"), {
                                shouldValidate: true,
                              });
                            } catch {
                              form.setError("amountPaise", { message: "Enter a valid amount" });
                            }
                          }}
                        />
                      </FormControl>
                      {overRemaining ? (
                        <p className="text-sm text-warn">
                          This exceeds the remaining {formatINR(remainingPaise)} — the month will
                          become OVERPAID and the surplus can be applied to next month.
                        </p>
                      ) : null}
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="paidAt"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Date</FormLabel>
                      <FormControl>
                        <DateFieldIST value={field.value} onChange={field.onChange} blockFuture />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="method"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Method</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue labels={METHOD_LABELS} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {PAYMENT_METHODS.map((m) => (
                            <SelectItem key={m} value={m}>
                              {METHOD_LABELS[m]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="accountId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Account</FormLabel>
                      <FormControl>
                        <AccountSelect value={field.value} onChange={field.onChange} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="invoiceNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Invoice Number *</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. INV-2026-001" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="receiptNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Receipt Number *</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. RCP-2026-001" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="reference"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Reference</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="note"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Note</FormLabel>
                      <FormControl>
                        <Textarea {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {formError ? (
                  <p role="alert" className="text-sm text-destructive">
                    {formError}
                  </p>
                ) : null}

                <SheetFooter className="px-0">
                  <Button type="submit" disabled={pending}>
                    {pending ? "Recording…" : "Record Payment"}
                  </Button>
                </SheetFooter>
              </form>
            </Form>
          </>
        )}
      </SheetContent>

      <ConfirmDialog
        open={largeConfirmOpen}
        onOpenChange={setLargeConfirmOpen}
        title="Confirm large amount"
        description={`You're recording ${formatINR(form.getValues("amountPaise"))} — please confirm the amount.`}
        onConfirm={() => doSubmit(form.getValues() as RecordPaymentInput)}
      />
    </Sheet>
  );
}
