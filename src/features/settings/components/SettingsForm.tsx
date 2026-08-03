"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { DateFieldIST } from "@/components/shared/DateFieldIST";
import { paiseToRupeesPlain, toPaise } from "@/lib/money";
import { updateSettingsAction } from "@/features/settings/actions";
import { updateSettingsSchema, type UpdateSettingsInput } from "@/schemas/settings.schema";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type SettingsFormValues = UpdateSettingsInput;

export type SettingsInitial = {
  companyName: string | null;
  largeExpenseAlertPaise: number;
  lowBalanceDefaultPaise: number;
  dueSoonDays: number;
  financialYearStartMonth: number;
  goLiveDate: string | null;
};

// Section 5.13/7.14 — owner-only general settings.
export function SettingsForm({ initial }: { initial: SettingsInitial }) {
  const router = useRouter();
  const [largeExpenseRupees, setLargeExpenseRupees] = React.useState(
    paiseToRupeesPlain(initial.largeExpenseAlertPaise)
  );
  const [lowBalanceRupees, setLowBalanceRupees] = React.useState(
    paiseToRupeesPlain(initial.lowBalanceDefaultPaise)
  );
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(updateSettingsSchema),
    defaultValues: {
      companyName: initial.companyName ?? "",
      largeExpenseAlertPaise: initial.largeExpenseAlertPaise,
      lowBalanceDefaultPaise: initial.lowBalanceDefaultPaise,
      dueSoonDays: initial.dueSoonDays,
      financialYearStartMonth: initial.financialYearStartMonth,
      goLiveDate: initial.goLiveDate ? new Date(initial.goLiveDate) : null,
    },
  });

  function submit(values: SettingsFormValues) {
    setFormError(null);
    startTransition(async () => {
      const result = await updateSettingsAction({
        companyName: values.companyName,
        largeExpenseAlertPaise: values.largeExpenseAlertPaise,
        lowBalanceDefaultPaise: values.lowBalanceDefaultPaise,
        dueSoonDays: values.dueSoonDays,
        financialYearStartMonth: values.financialYearStartMonth,
        goLiveDate: values.goLiveDate ?? null,
      });
      if (!result.success) {
        setFormError(result.message);
        return;
      }
      toast.success("Settings saved.");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">General Settings</CardTitle>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(submit)} className="grid gap-4" noValidate>
            <FormField
              control={form.control}
              name="companyName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Company name</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="largeExpenseAlertPaise"
                render={() => (
                  <FormItem>
                    <FormLabel>Large expense alert threshold</FormLabel>
                    <FormControl>
                      <Input
                        inputMode="decimal"
                        value={largeExpenseRupees}
                        onChange={(e) => setLargeExpenseRupees(e.target.value)}
                        onBlur={() => {
                          try {
                            form.setValue("largeExpenseAlertPaise", toPaise(largeExpenseRupees || "0"), {
                              shouldValidate: true,
                            });
                          } catch {
                            form.setError("largeExpenseAlertPaise", { message: "Enter a valid amount" });
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
                name="lowBalanceDefaultPaise"
                render={() => (
                  <FormItem>
                    <FormLabel>Low balance threshold (default)</FormLabel>
                    <FormControl>
                      <Input
                        inputMode="decimal"
                        value={lowBalanceRupees}
                        onChange={(e) => setLowBalanceRupees(e.target.value)}
                        onBlur={() => {
                          try {
                            form.setValue("lowBalanceDefaultPaise", toPaise(lowBalanceRupees || "0"), {
                              shouldValidate: true,
                            });
                          } catch {
                            form.setError("lowBalanceDefaultPaise", { message: "Enter a valid amount" });
                          }
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="dueSoonDays"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Due-soon window (days)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        max={60}
                        value={field.value}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="financialYearStartMonth"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Financial year starts</FormLabel>
                    <Select value={String(field.value)} onValueChange={(v) => field.onChange(Number(v))}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {MONTH_NAMES.map((name, i) => (
                          <SelectItem key={name} value={String(i + 1)}>
                            {name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="goLiveDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Go-live date</FormLabel>
                  <FormControl>
                    <DateFieldIST value={field.value} onChange={field.onChange} />
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

            <Button type="submit" disabled={pending} className="w-fit">
              {pending ? "Saving…" : "Save settings"}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
