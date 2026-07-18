"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { AccountSelect } from "@/components/shared/AccountSelect";
import { DateFieldIST } from "@/components/shared/DateFieldIST";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { formatINR, toPaise } from "@/lib/money";
import { LARGE_ENTRY_CONFIRM_PAISE } from "@/constants/finance";
import { transferAction } from "@/features/accounts/actions";
import type { UserRole } from "@/constants/roles";

type FormValues = {
  fromAccountId: string;
  toAccountId: string;
  amountPaise: number;
  note: string | null;
  occurredAt: Date | undefined;
  overrideNegativeBalance: boolean;
  idempotencyKey: string;
};

function makeDefaults(): FormValues {
  return {
    fromAccountId: "",
    toAccountId: "",
    amountPaise: 0,
    note: null,
    occurredAt: new Date(),
    overrideNegativeBalance: false,
    idempotencyKey: crypto.randomUUID(),
  };
}

// Section 6.5 — transferBetweenAccounts sheet. Role: admin+ (the action
// itself re-checks; this component is only ever rendered for admin+ by
// its caller).
export function TransferSheet({ role }: { role: UserRole }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [amountRupees, setAmountRupees] = React.useState("0");
  const [largeConfirmOpen, setLargeConfirmOpen] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [success, setSuccess] = React.useState<{ amountPaise: number } | null>(null);

  const form = useForm<FormValues>({ defaultValues: makeDefaults() });

  function resetForOpen() {
    setSuccess(null);
    setFormError(null);
    setAmountRupees("0");
    form.reset(makeDefaults());
  }

  function submit(values: FormValues) {
    if (!values.occurredAt) return;
    if (values.fromAccountId === values.toAccountId) {
      form.setError("toAccountId", { message: "Choose two different accounts." });
      return;
    }
    if (values.amountPaise >= LARGE_ENTRY_CONFIRM_PAISE && !largeConfirmOpen) {
      setLargeConfirmOpen(true);
      return;
    }
    doSubmit(values);
  }

  function doSubmit(values: FormValues) {
    if (!values.occurredAt) return;
    setFormError(null);
    startTransition(async () => {
      const result = await transferAction({
        fromAccountId: values.fromAccountId,
        toAccountId: values.toAccountId,
        amountPaise: values.amountPaise,
        note: values.note,
        occurredAt: values.occurredAt,
        overrideNegativeBalance: values.overrideNegativeBalance,
        idempotencyKey: values.idempotencyKey,
      });
      if (!result.success) {
        if (result.error.code === "IDEMPOTENT_REPLAY") {
          setOpen(false);
          router.refresh();
          return;
        }
        setFormError(result.message);
        return;
      }
      setSuccess({ amountPaise: values.amountPaise });
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
      <SheetTrigger render={<Button variant="outline" />}>Transfer</SheetTrigger>
      <SheetContent>
        {success ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
            <CheckCircle2 className="size-12 text-money-in" />
            <p className="text-xl font-semibold">{formatINR(success.amountPaise)} transferred</p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Done
              </Button>
              <Button onClick={resetForOpen}>Transfer another</Button>
            </div>
          </div>
        ) : (
          <>
            <SheetHeader>
              <SheetTitle>Transfer between accounts</SheetTitle>
              <SheetDescription>Both legs are recorded atomically on the ledger.</SheetDescription>
            </SheetHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(submit)} className="grid gap-4 px-4" noValidate>
                <FormField
                  control={form.control}
                  name="fromAccountId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>From</FormLabel>
                      <FormControl>
                        <AccountSelect value={field.value} onChange={field.onChange} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="toAccountId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>To</FormLabel>
                      <FormControl>
                        <AccountSelect value={field.value} onChange={field.onChange} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
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
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="occurredAt"
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
                {role === "owner" ? (
                  <FormField
                    control={form.control}
                    name="overrideNegativeBalance"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center gap-2">
                        <FormControl>
                          <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                        <FormLabel className="!mt-0">
                          Allow this transfer to push the source account negative
                        </FormLabel>
                      </FormItem>
                    )}
                  />
                ) : null}

                {formError ? (
                  <p role="alert" className="text-sm text-destructive">
                    {formError}
                  </p>
                ) : null}

                <SheetFooter className="px-0">
                  <Button type="submit" disabled={pending}>
                    {pending ? "Transferring…" : "Transfer"}
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
        description={`You're transferring ${formatINR(form.getValues("amountPaise"))} — please confirm the amount.`}
        onConfirm={() => doSubmit(form.getValues())}
      />
    </Sheet>
  );
}
