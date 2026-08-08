"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { TypedConfirmDialog } from "@/components/shared/TypedConfirmDialog";
import { ACCOUNT_TYPES } from "@/constants/domain";
import { formatINR, paiseToRupeesPlain, toPaise } from "@/lib/money";
import { updateAccountAction } from "@/features/accounts/actions";
import type { AccountRow } from "@/features/accounts/actions";
import type { UserRole } from "@/constants/roles";

const TYPE_LABELS: Record<(typeof ACCOUNT_TYPES)[number], string> = {
  bank: "Bank",
  cash: "Cash",
  upi_wallet: "UPI Wallet",
  other: "Other",
};

type FormValues = {
  name: string;
  type: (typeof ACCOUNT_TYPES)[number];
  bankName: string | null;
  last4: string | null;
  lowBalanceThresholdPaise: number | null;
};

// Section 6.9 — general edit fields, plus (owner-only) opening-balance
// change behind its own typed-confirm gate (Section 14 edge case 23).
export function EditAccountSheet({ account, role }: { account: AccountRow; role: UserRole }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [conflict, setConflict] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [openingConfirmOpen, setOpeningConfirmOpen] = React.useState(false);
  const [newOpeningRupees, setNewOpeningRupees] = React.useState(paiseToRupeesPlain(account.openingBalancePaise));

  const form = useForm<FormValues>({
    defaultValues: {
      name: account.name,
      type: account.type as (typeof ACCOUNT_TYPES)[number],
      bankName: account.bankName,
      last4: account.last4,
      lowBalanceThresholdPaise: account.lowBalanceThresholdPaise,
    },
  });

  function submit(values: FormValues) {
    setFormError(null);
    setConflict(false);
    startTransition(async () => {
      const result = await updateAccountAction({ accountId: account.id, version: account.version, ...values });
      if (!result.success) {
        if (result.error.code === "CONFLICT") setConflict(true);
        setFormError(result.message);
        return;
      }
      setOpen(false);
      toast.success("Account updated.");
      router.refresh();
    });
  }

  async function submitOpeningBalance() {
    let openingBalancePaise: number;
    try {
      openingBalancePaise = toPaise(newOpeningRupees || "0");
    } catch {
      setFormError("Enter a valid amount");
      return;
    }
    const result = await updateAccountAction({
      accountId: account.id,
      version: account.version,
      openingBalancePaise,
    });
    if (!result.success) {
      setFormError(result.message);
      return;
    }
    toast.success("Opening balance updated.");
    router.refresh();
  }

  return (
    <>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger render={<Button variant="outline" />}>Edit</SheetTrigger>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Edit account</SheetTitle>
            <SheetDescription>{account.name}</SheetDescription>
          </SheetHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(submit)} className="grid gap-4 px-4" noValidate>
              {conflict ? (
                <p className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm text-warn">
                  This account was updated by someone else. Refresh to see the latest.
                </p>
              ) : null}
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input {...field} />
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

              {role === "owner" ? (
                <div className="grid gap-1.5 rounded-lg border p-3">
                  <Label>Opening balance</Label>
                  <p className="text-sm text-muted-foreground">
                    Currently {formatINR(account.openingBalancePaise)}. Changing this shifts the
                    current balance by the same amount and is fully audited.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-fit"
                    onClick={() => setOpeningConfirmOpen(true)}
                  >
                    Change opening balance
                  </Button>
                </div>
              ) : null}

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

      <TypedConfirmDialog
        open={openingConfirmOpen}
        onOpenChange={setOpeningConfirmOpen}
        title="Change opening balance"
        keyword="CHANGE"
        confirmLabel="Change"
        description={`This changes ${account.name}'s recorded opening balance and shifts its current balance by the same delta. This is an owner-only, fully audited action.`}
        extraField={
          <div className="grid gap-1.5">
            <Label htmlFor="new-opening-balance">New opening balance</Label>
            <Input
              id="new-opening-balance"
              inputMode="decimal"
              value={newOpeningRupees}
              onChange={(e) => setNewOpeningRupees(e.target.value)}
            />
          </div>
        }
        onConfirm={submitOpeningBalance}
      />
    </>
  );
}
