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
import { createBorrowingSchema, type CreateBorrowingInput } from "@/schemas/borrowing.schema";
import { formatINR, toPaise } from "@/lib/money";
import { LARGE_ENTRY_CONFIRM_PAISE } from "@/constants/finance";
import { createBorrowingAction } from "@/features/borrowings/actions";
import type { UserRole } from "@/constants/roles";

type FormValues = Omit<CreateBorrowingInput, "lentAt" | "expectedBackBy"> & {
  lentAt: Date | undefined;
  expectedBackBy: Date | null | undefined;
};

function makeDefaults(): FormValues {
  return {
    borrowerName: "",
    borrowerPhone: null,
    principalPaise: 0,
    lentAt: new Date(),
    accountId: "",
    reason: null,
    note: null,
    expectedBackBy: null,
    attachments: [],
    overrideNegativeBalance: false,
    idempotencyKey: crypto.randomUUID(),
  };
}

/**
 * Section 6.9 — lend money out.
 *
 * The success panel leads with what is still owed rather than the new
 * account balance, because that is the number this record exists to track:
 * the balance drop is a side effect, the receivable is the point.
 */
export function LendMoneySheet({ role }: { role: UserRole }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [amountRupees, setAmountRupees] = React.useState("0");
  const [largeConfirmOpen, setLargeConfirmOpen] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [success, setSuccess] = React.useState<{
    amountPaise: number;
    borrowerName: string;
    accountNewBalance: number;
  } | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(createBorrowingSchema) as never,
    defaultValues: makeDefaults(),
  });

  function resetForOpen() {
    setSuccess(null);
    setFormError(null);
    setAmountRupees("0");
    form.reset(makeDefaults());
  }

  function submit(values: FormValues) {
    if (!values.lentAt) return;
    if (values.principalPaise >= LARGE_ENTRY_CONFIRM_PAISE && !largeConfirmOpen) {
      setLargeConfirmOpen(true);
      return;
    }
    doSubmit(values as CreateBorrowingInput);
  }

  function doSubmit(values: CreateBorrowingInput) {
    setFormError(null);
    startTransition(async () => {
      const result = await createBorrowingAction(values);
      if (!result.success) {
        if (result.error.code === "IDEMPOTENT_REPLAY") {
          setOpen(false);
          router.refresh();
          return;
        }
        setFormError(result.message);
        return;
      }
      setSuccess({
        amountPaise: values.principalPaise,
        borrowerName: values.borrowerName,
        accountNewBalance: result.data.accountNewBalance,
      });
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
      <SheetTrigger render={<Button />}>Lend Money</SheetTrigger>
      <SheetContent>
        {success ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
            <CheckCircle2 className="size-12 text-money-out" />
            <p className="text-xl font-semibold">
              {formatINR(success.amountPaise)} lent to {success.borrowerName}
            </p>
            <p className="text-sm text-muted-foreground">
              That much is now owed back to you. Account balance:{" "}
              {formatINR(success.accountNewBalance)}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Done
              </Button>
              <Button onClick={resetForOpen}>Lend to someone else</Button>
            </div>
          </div>
        ) : (
          <>
            <SheetHeader>
              <SheetTitle>Lend money</SheetTitle>
              <SheetDescription>
                Money handed to someone that you expect back. This is not an expense — it stays
                tracked as owed to you until it is repaid.
              </SheetDescription>
            </SheetHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(submit)} className="grid gap-4 px-4" noValidate>
                <FormField
                  control={form.control}
                  name="borrowerName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Lent to</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Name of the person" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="borrowerPhone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone (optional)</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          value={field.value ?? ""}
                          onChange={(e) => field.onChange(e.target.value || null)}
                          inputMode="tel"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="principalPaise"
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
                              form.setValue("principalPaise", toPaise(amountRupees || "0"), {
                                shouldValidate: true,
                              });
                            } catch {
                              form.setError("principalPaise", { message: "Enter a valid amount" });
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
                  name="accountId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Paid from</FormLabel>
                      <FormControl>
                        <AccountSelect value={field.value} onChange={field.onChange} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="lentAt"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Date lent</FormLabel>
                      <FormControl>
                        <DateFieldIST value={field.value} onChange={field.onChange} blockFuture />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="expectedBackBy"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Expected back by (optional)</FormLabel>
                      <FormControl>
                        {/* No `blockFuture`: the whole point of this date is
                            that it is in the future. */}
                        <DateFieldIST value={field.value} onChange={field.onChange} />
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
                      <FormLabel>Reason (optional)</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          value={field.value ?? ""}
                          onChange={(e) => field.onChange(e.target.value || null)}
                          placeholder="e.g. Medical emergency, salary advance"
                        />
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
                          <Checkbox
                            checked={field.value ?? false}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <FormLabel className="mt-0!">
                          Allow this to push the account negative
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
                    {pending ? "Recording…" : "Record loan"}
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
        description={`You're lending ${formatINR(form.getValues("principalPaise"))} — please confirm the amount.`}
        onConfirm={() => doSubmit(form.getValues() as CreateBorrowingInput)}
      />
    </Sheet>
  );
}
