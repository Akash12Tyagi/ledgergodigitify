"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { createAccountSchema, type CreateAccountInput } from "@/schemas/account.schema";
import { ACCOUNT_TYPES } from "@/constants/domain";
import { toPaise } from "@/lib/money";
import { createAccountAction } from "@/features/accounts/actions";

const TYPE_LABELS: Record<(typeof ACCOUNT_TYPES)[number], string> = {
  bank: "Bank",
  cash: "Cash",
  upi_wallet: "UPI Wallet",
  other: "Other",
};

type FormValues = CreateAccountInput;

// Section 6.9/7.7 — createAccount sheet, reachable from /ledger/accounts.
export function CreateAccountSheet() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [openingRupees, setOpeningRupees] = React.useState("0");
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const form = useForm<FormValues>({
    resolver: zodResolver(createAccountSchema) as never,
    defaultValues: {
      name: "",
      type: "bank",
      openingBalancePaise: 0,
      bankName: null,
      last4: null,
      lowBalanceThresholdPaise: null,
      isDefault: false,
    },
  });

  function submit(values: FormValues) {
    setFormError(null);
    startTransition(async () => {
      const result = await createAccountAction(values);
      if (!result.success) {
        setFormError(result.message);
        return;
      }
      setOpen(false);
      form.reset({
        name: "",
        type: "bank",
        openingBalancePaise: 0,
        bankName: null,
        last4: null,
        lowBalanceThresholdPaise: null,
        isDefault: false,
      });
      setOpeningRupees("0");
      toast.success("Account created.");
      router.refresh();
    });
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button />}>New Account</SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>New account</SheetTitle>
          <SheetDescription>Bank, cash, or UPI wallet ledger account.</SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(submit)} className="grid gap-4 px-4" noValidate>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="HDFC Current" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue labels={TYPE_LABELS} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {ACCOUNT_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {TYPE_LABELS[t]}
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
              name="openingBalancePaise"
              render={() => (
                <FormItem>
                  <FormLabel>Opening balance</FormLabel>
                  <FormControl>
                    <Input
                      inputMode="decimal"
                      value={openingRupees}
                      onChange={(e) => setOpeningRupees(e.target.value)}
                      onBlur={() => {
                        try {
                          form.setValue("openingBalancePaise", toPaise(openingRupees || "0"), {
                            shouldValidate: true,
                          });
                        } catch {
                          form.setError("openingBalancePaise", { message: "Enter a valid amount" });
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
              name="bankName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Bank name</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="last4"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Last 4 digits</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ""} maxLength={4} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="isDefault"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center gap-2">
                  <FormControl>
                    <Checkbox checked={field.value ?? false} onCheckedChange={field.onChange} />
                  </FormControl>
                  <FormLabel className="!mt-0">Make this the default account</FormLabel>
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
                {pending ? "Creating…" : "Create account"}
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
