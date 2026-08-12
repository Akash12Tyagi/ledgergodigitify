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
  createExpenseTemplateSchema,
  type CreateExpenseTemplateInput,
} from "@/schemas/expense-template.schema";
import { EXPENSE_CATEGORIES } from "@/constants/domain";
import { toPaise } from "@/lib/money";
import { createExpenseTemplateAction } from "@/features/expense-templates/actions";

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

type FormValues = Omit<CreateExpenseTemplateInput, "startDate"> & { startDate: Date | undefined };

function makeDefaults(): FormValues {
  return {
    amountPaise: 0,
    reason: "",
    paidToEntity: "",
    category: "salary",
    accountId: "",
    startDate: new Date(),
    note: null,
    idempotencyKey: crypto.randomUUID(),
  };
}

/**
 * Section 6.3.4 — sets up a recurring expense. Note what this form does NOT
 * do: it never moves money. It records an intention, and the daily cron
 * turns that into a pending expense each period for someone to approve.
 *
 * `startDate` is not capped at today (no `blockFuture`), unlike a real
 * expense's date: scheduling a rent that begins next month is the normal
 * case, and back-dating to April so the missed periods are raised as
 * catch-up is a legitimate one too.
 */
export function CreateExpenseTemplateSheet() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [amountRupees, setAmountRupees] = React.useState("0");
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const form = useForm<FormValues>({
    resolver: zodResolver(createExpenseTemplateSchema) as never,
    defaultValues: makeDefaults(),
  });

  function submit(values: FormValues) {
    if (!values.startDate) return;
    setFormError(null);
    startTransition(async () => {
      const result = await createExpenseTemplateAction(values as CreateExpenseTemplateInput);
      if (!result.success) {
        setFormError(result.message);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  const startDate = form.watch("startDate");
  const anchorDay = startDate ? new Date(startDate).getDate() : null;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setAmountRupees("0");
          setFormError(null);
          form.reset(makeDefaults());
        }
      }}
    >
      <SheetTrigger render={<Button />}>New Recurring Expense</SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>New recurring expense</SheetTitle>
          <SheetDescription>
            Raised automatically each period as a pending expense. Money only moves once someone
            approves it.
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
                    <Input {...field} placeholder="e.g. Landlord, Ramesh Kumar" />
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
                    <Input {...field} placeholder="e.g. Office rent, Monthly salary" />
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
              name="startDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Starts on</FormLabel>
                  <FormControl>
                    <DateFieldIST value={field.value} onChange={field.onChange} />
                  </FormControl>
                  {anchorDay ? (
                    <p className="text-xs text-muted-foreground">
                      Repeats on day {anchorDay} of every month. In shorter months it lands on the
                      last day, then returns to {anchorDay}.
                    </p>
                  ) : null}
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
                {pending ? "Saving…" : "Create recurring expense"}
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
