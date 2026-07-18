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
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { AccountSelect } from "@/components/shared/AccountSelect";
import { DateFieldIST } from "@/components/shared/DateFieldIST";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { FileUpload } from "@/components/shared/FileUpload";
import { createCreditSchema, type CreateCreditInput } from "@/schemas/credit.schema";
import { CREDIT_CATEGORIES } from "@/constants/domain";
import { formatINR, toPaise } from "@/lib/money";
import { LARGE_ENTRY_CONFIRM_PAISE } from "@/constants/finance";
import { createCreditAction } from "@/features/credits/actions";

const CATEGORY_LABELS: Record<(typeof CREDIT_CATEGORIES)[number], string> = {
  owner_capital: "Owner Capital",
  loan: "Loan",
  refund: "Refund",
  interest: "Interest",
  grant: "Grant",
  other: "Other",
};

type FormValues = Omit<CreateCreditInput, "receivedAt"> & { receivedAt: Date | undefined };

function makeDefaults(): FormValues {
  return {
    amountPaise: 0,
    source: "",
    reason: "",
    category: "other",
    accountId: "",
    receivedAt: new Date(),
    note: null,
    attachments: [],
    idempotencyKey: crypto.randomUUID(),
  };
}

// Section 6.4/7.9 — createCredit sheet.
export function CreateCreditSheet() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [amountRupees, setAmountRupees] = React.useState("0");
  const [largeConfirmOpen, setLargeConfirmOpen] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [success, setSuccess] = React.useState<{ amountPaise: number; accountNewBalance: number } | null>(
    null
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(createCreditSchema) as never,
    defaultValues: makeDefaults(),
  });

  function resetForOpen() {
    setSuccess(null);
    setFormError(null);
    setAmountRupees("0");
    form.reset(makeDefaults());
  }

  function submit(values: FormValues) {
    if (!values.receivedAt) return;
    if (values.amountPaise >= LARGE_ENTRY_CONFIRM_PAISE && !largeConfirmOpen) {
      setLargeConfirmOpen(true);
      return;
    }
    doSubmit(values as CreateCreditInput);
  }

  function doSubmit(values: CreateCreditInput) {
    setFormError(null);
    startTransition(async () => {
      const result = await createCreditAction(values);
      if (!result.success) {
        if (result.error.code === "IDEMPOTENT_REPLAY") {
          setOpen(false);
          router.refresh();
          return;
        }
        setFormError(result.message);
        return;
      }
      setSuccess({ amountPaise: values.amountPaise, accountNewBalance: result.data.accountNewBalance });
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
      <SheetTrigger render={<Button />}>New Credit</SheetTrigger>
      <SheetContent>
        {success ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
            <CheckCircle2 className="size-12 text-money-in" />
            <p className="text-xl font-semibold">{formatINR(success.amountPaise)} recorded</p>
            <p className="text-sm">New account balance: {formatINR(success.accountNewBalance)}</p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Done
              </Button>
              <Button onClick={resetForOpen}>Record another</Button>
            </div>
          </div>
        ) : (
          <>
            <SheetHeader>
              <SheetTitle>New credit</SheetTitle>
              <SheetDescription>Money in that isn&apos;t client revenue.</SheetDescription>
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
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="source"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Source</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="reason"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Reason</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Category</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {CREDIT_CATEGORIES.map((c) => (
                            <SelectItem key={c} value={c}>
                              {CATEGORY_LABELS[c]}
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
                <FormField
                  control={form.control}
                  name="receivedAt"
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
                <FormField
                  control={form.control}
                  name="attachments"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Attachments</FormLabel>
                      <FormControl>
                        <FileUpload scope="credits" value={field.value ?? []} onChange={field.onChange} />
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
                    {pending ? "Recording…" : "Record Credit"}
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
        onConfirm={() => doSubmit(form.getValues() as CreateCreditInput)}
      />
    </Sheet>
  );
}
