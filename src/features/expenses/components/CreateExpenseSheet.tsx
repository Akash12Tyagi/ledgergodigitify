"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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
import { createExpenseSchema, type CreateExpenseInput } from "@/schemas/expense.schema";
import { EXPENSE_CATEGORIES } from "@/constants/domain";
import { formatINR, toPaise } from "@/lib/money";
import { LARGE_ENTRY_CONFIRM_PAISE } from "@/constants/finance";
import { createExpenseAction } from "@/features/expenses/actions";
import type { UserRole } from "@/constants/roles";

const CATEGORY_LABELS: Record<(typeof EXPENSE_CATEGORIES)[number], string> = {
  salary: "Salary",
  incentive: "Incentive",
  rent: "Rent",
  software: "Software",
  vendor: "Vendor",
  tax: "Tax",
  utilities: "Utilities",
  marketing: "Marketing",
  travel: "Travel",
  misc: "Misc",
};

type FormValues = Omit<CreateExpenseInput, "spentAt"> & { spentAt: Date | undefined };

function makeDefaults(): FormValues {
  return {
    amountPaise: 0,
    reason: "",
    paidToEntity: "",
    category: "misc",
    accountId: "",
    spentAt: new Date(),
    note: null,
    attachments: [],
    overrideNegativeBalance: false,
    idempotencyKey: crypto.randomUUID(),
  };
}

// Section 6.3/7.6 — createExpense sheet.
export function CreateExpenseSheet({ role }: { role: UserRole }) {
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
    resolver: zodResolver(createExpenseSchema) as never,
    defaultValues: makeDefaults(),
  });

  function resetForOpen() {
    setSuccess(null);
    setFormError(null);
    setAmountRupees("0");
    form.reset(makeDefaults());
  }

  function submit(values: FormValues) {
    if (!values.spentAt) return;
    if (values.amountPaise >= LARGE_ENTRY_CONFIRM_PAISE && !largeConfirmOpen) {
      setLargeConfirmOpen(true);
      return;
    }
    doSubmit(values as CreateExpenseInput);
  }

  function doSubmit(values: CreateExpenseInput) {
    setFormError(null);
    startTransition(async () => {
      const result = await createExpenseAction(values);
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
      <SheetTrigger render={<Button />}>New Expense</SheetTrigger>
      <SheetContent>
        {success ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
            <CheckCircle2 className="size-12 text-money-out" />
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
              <SheetTitle>New expense</SheetTitle>
              <SheetDescription>Money paid out of an account.</SheetDescription>
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
                  name="paidToEntity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Paid to</FormLabel>
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
                          {EXPENSE_CATEGORIES.map((c) => (
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
                  name="spentAt"
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
                        <FileUpload
                          scope="expenses"
                          value={field.value ?? []}
                          onChange={field.onChange}
                        />
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
                          <Checkbox checked={field.value ?? false} onCheckedChange={field.onChange} />
                        </FormControl>
                        <FormLabel className="!mt-0">Allow this to push the account negative</FormLabel>
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
                    {pending ? "Recording…" : "Record Expense"}
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
        onConfirm={() => doSubmit(form.getValues() as CreateExpenseInput)}
      />
    </Sheet>
  );
}
