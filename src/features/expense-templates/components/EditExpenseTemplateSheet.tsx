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
import {
  updateExpenseTemplateSchema,
  type UpdateExpenseTemplateInput,
} from "@/schemas/expense-template.schema";
import { EXPENSE_CATEGORIES } from "@/constants/domain";
import { paiseToRupeesPlain, toPaise } from "@/lib/money";
import { updateExpenseTemplateAction } from "@/features/expense-templates/actions";
import type { ExpenseTemplateRow } from "@/types/expense";

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

/**
 * Edits the recurring definition — a raise changes the salary from next
 * period on. It does NOT touch periods already raised: those are real
 * pending expenses now, edited individually.
 *
 * `startDate` is absent by design (see updateExpenseTemplateSchema): it is
 * the anchor every raised period was advanced from, so changing it would
 * re-date history.
 */
export function EditExpenseTemplateSheet({ template }: { template: ExpenseTemplateRow }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [amountRupees, setAmountRupees] = React.useState(paiseToRupeesPlain(template.amountPaise));
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function defaults(): UpdateExpenseTemplateInput {
    return {
      templateId: template.id,
      amountPaise: template.amountPaise,
      reason: template.reason,
      paidToEntity: template.paidToEntity,
      category: template.category as (typeof EXPENSE_CATEGORIES)[number],
      accountId: template.accountId,
      billingDay: template.billingDay,
      note: template.note,
      version: template.version,
    };
  }

  const form = useForm<UpdateExpenseTemplateInput>({
    resolver: zodResolver(updateExpenseTemplateSchema) as never,
    defaultValues: defaults(),
  });

  function submit(values: UpdateExpenseTemplateInput) {
    setFormError(null);
    startTransition(async () => {
      const result = await updateExpenseTemplateAction(values);
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
          setAmountRupees(paiseToRupeesPlain(template.amountPaise));
          setFormError(null);
          form.reset(defaults());
        }
      }}
    >
      <SheetTrigger render={<Button variant="ghost" size="sm" />}>Edit</SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Edit recurring expense</SheetTitle>
          <SheetDescription>
            Applies from the next period on. Expenses already raised are not changed.
          </SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(submit)} className="grid gap-4 px-4" noValidate>
            <FormField
              control={form.control}
              name="amountPaise"
              render={() => (
                <FormItem>
                  <FormLabel>Amount each period</FormLabel>
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
                  <FormLabel>Pay from</FormLabel>
                  <FormControl>
                    <AccountSelect value={field.value} onChange={field.onChange} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="billingDay"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Repeats on day</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      max={31}
                      value={field.value}
                      onChange={(e) => field.onChange(Number(e.target.value))}
                    />
                  </FormControl>
                  <p className="text-xs text-muted-foreground">
                    Day of the month. 29–31 land on the last day of shorter months, then return.
                  </p>
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
