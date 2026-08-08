"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm, type Resolver } from "react-hook-form";
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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { DateFieldIST } from "@/components/shared/DateFieldIST";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { clientInputSchema, type ClientInput } from "@/schemas/client.schema";
import { toPaise } from "@/lib/money";
import { todayIST } from "@/lib/dates";
import { createClientAction, checkClientNameAction } from "@/features/clients/actions";

// Section 7.3 — create-client form. 5 required fields in "Basics"; the
// rest are optional sections. Amount is entered as rupees and parsed to
// paise via lib/money.ts on submit — the form field itself stays a plain
// string so users can type "12,000" naturally.
//
// nextDueDate has no default (Section 7.3: "default = today+30d hint but
// empty") — it's a required Date in the validated ClientInput, but must be
// representable as `undefined` while the user hasn't picked one yet, so
// the form's working type widens just that field; the Resolver cast is
// the standard, narrow bridge for this (well-known) react-hook-form/zod
// gap, not a broad type-safety opt-out.
type ClientFormValues = Omit<ClientInput, "nextDueDate"> & { nextDueDate: Date | undefined };

export function ClientForm() {
  const router = useRouter();
  const [amountRupees, setAmountRupees] = React.useState("");
  const [duplicateWarning, setDuplicateWarning] = React.useState<{
    name: string;
    existingClientId: string;
  } | null>(null);
  const [pastDueConfirmOpen, setPastDueConfirmOpen] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const form = useForm<ClientFormValues>({
    resolver: zodResolver(clientInputSchema) as Resolver<ClientFormValues>,
    defaultValues: {
      name: "",
      service: "",
      engagementType: "retainer",
      amountPaise: 0,
      nextDueDate: undefined,
      billingDay: null,
      email: null,
      phone: null,
      company: null,
      address: null,
      gstin: null,
      notes: null,
    },
  });

  const engagementType = form.watch("engagementType");

  async function checkDuplicateName(name: string) {
    if (!name.trim()) return;
    const result = await checkClientNameAction(name);
    if (result.success && result.data.duplicate && result.data.existingClientId) {
      setDuplicateWarning({ name, existingClientId: result.data.existingClientId });
    } else {
      setDuplicateWarning(null);
    }
  }

  function submit(values: ClientFormValues) {
    setFormError(null);
    const isPastDue = values.nextDueDate && values.nextDueDate.toISOString() < `${todayIST()}T00:00:00.000Z`;
    if (isPastDue && !pastDueConfirmOpen) {
      setPastDueConfirmOpen(true);
      return;
    }
    doSubmit(values);
  }

  // zodResolver already guaranteed nextDueDate is a real Date by the time
  // handleSubmit invokes this — the type only says `Date | undefined`
  // because the field starts empty (see ClientFormValues above).
  function doSubmit(values: ClientFormValues) {
    startTransition(async () => {
      const result = await createClientAction(values as ClientInput);
      if (!result.success) {
        setFormError(result.message);
        return;
      }
      router.push(`/clients/${result.data.clientId}`);
      router.refresh();
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="grid gap-6" noValidate>
        <Card>
          <CardHeader>
            <CardTitle>Basics</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name *</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      value={field.value ?? ""}
                      onBlur={() => {
                        field.onBlur();
                        void checkDuplicateName(field.value ?? "");
                      }}
                    />
                  </FormControl>
                  {duplicateWarning ? (
                    <p className="text-sm text-warn">
                      A client named &quot;{duplicateWarning.name}&quot; already exists —{" "}
                      <Link href={`/clients/${duplicateWarning.existingClientId}`} className="underline">
                        view it
                      </Link>
                      ?
                    </p>
                  ) : null}
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="service"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Service *</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="engagementType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Type *</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue
                          labels={{
                            retainer: "Retainer (monthly)",
                            one_time: "One-time project",
                          }}
                        />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="retainer">Retainer (monthly)</SelectItem>
                      <SelectItem value="one_time">One-time project</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="amountPaise"
              render={() => (
                <FormItem>
                  <FormLabel>{engagementType === "retainer" ? "Monthly amount *" : "Total amount *"}</FormLabel>
                  <FormControl>
                    <Input
                      inputMode="decimal"
                      placeholder="₹0"
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
              name="nextDueDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Next due date *</FormLabel>
                  <FormControl>
                    <DateFieldIST value={field.value} onChange={field.onChange} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Contact</CardTitle>
            <CardDescription>Optional</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ""} type="email" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="company"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Company</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Address</FormLabel>
                  <FormControl>
                    <Textarea {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Other</CardTitle>
            <CardDescription>Optional</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <FormField
              control={form.control}
              name="gstin"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>GSTIN</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {formError ? (
          <p role="alert" className="text-sm text-destructive">
            {formError}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => router.back()} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create client"}
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={pastDueConfirmOpen}
        onOpenChange={setPastDueConfirmOpen}
        title="This due date is already in the past"
        description="The client will show as overdue immediately. Continue?"
        confirmLabel="Continue"
        onConfirm={() => doSubmit(form.getValues())}
      />
    </Form>
  );
}
