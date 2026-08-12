"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

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
import {
  updatePendingExpenseSchema,
  type UpdatePendingExpenseInput,
} from "@/schemas/expense.schema";
import { EXPENSE_CATEGORIES } from "@/constants/domain";
import { paiseToRupeesPlain, toPaise } from "@/lib/money";
import { updatePendingExpenseAction } from "@/features/expenses/actions";
import type { ExpenseRow } from "@/types/expense";

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

type FormValues = Omit<UpdatePendingExpenseInput, "spentAt"> & { spentAt: Date | undefined };

/**
 * Section 6.3.3 — editing, offered ONLY on pending rows. This is the escape
 * hatch that makes recurring expenses usable: the template says ₹50,000
 * salary, but this month there is a bonus, so the raised row is corrected
 * before anyone approves it. Nothing has posted, so nothing is being
 * rewritten.
 *
 * `version` rides along for the optimistic lock — if the row was approved or
 * edited elsewhere while this sheet was open, the save fails loudly instead
 * of silently clobbering.
 */
export function EditPendingExpenseSheet({ expense }: { expense: ExpenseRow }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [amountRupees, setAmountRupees] = React.useState(paiseToRupeesPlain(expense.amountPaise));
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function defaults(): FormValues {
    return {
      expenseId: expense.id,
      amountPaise: expense.amountPaise,
      reason: expense.reason,
      paidToEntity: expense.paidToEntity,
      category: expense.category as (typeof EXPENSE_CATEGORIES)[number],
      accountId: expense.accountId,
      spentAt: new Date(expense.spentAt),
      note: expense.note,
      attachments: [],
      version: expense.version,
    };
  }

  const form = useForm<FormValues>({
    resolver: zodResolver(updatePendingExpenseSchema) as never,
    defaultValues: defaults(),
  });

  function submit(values: FormValues) {
    if (!values.spentAt) return;
    setFormError(null);
    startTransition(async () => {
      const result = await updatePendingExpenseAction(values as UpdatePendingExpenseInput);
      if (!result.success) {
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
        if (next) {
          setAmountRupees(paiseToRupeesPlain(expense.amountPaise));
          setFormError(null);
          form.reset(defaults());
        }
      }}
    >
      <SheetTrigger render={<Button variant="ghost" size="sm" />}>Edit</SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Edit pending expense</SheetTitle>
          <SheetDescription>
            {expense.periodLabel
              ? `For ${expense.periodLabel}. Nothing has been deducted yet.`
              : "Nothing has been deducted yet."}
          </SheetDescription>
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
                        <SelectValue labels={CATEGORY_LABELS} />
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
                  <FormLabel>Expected date</FormLabel>
                  <FormControl>
                    <DateFieldIST value={field.value} onChange={field.onChange} />
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
                {pending ? "Saving…" : "Save changes"}
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
