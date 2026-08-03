"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { DateFieldIST } from "@/components/shared/DateFieldIST";
import { paiseToRupeesPlain, toPaise } from "@/lib/money";
import { updateClientAction } from "@/features/clients/actions";
import type { UpdateClientInput } from "@/schemas/client.schema";

type EditableClient = {
  id: string;
  name: string;
  service: string;
  amountPaise: number;
  nextDueDate: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  address: string | null;
  gstin: string | null;
  notes: string | null;
  version: number;
};

type EditClientFormValues = {
  name: string;
  service: string;
  amountPaise: number;
  nextDueDate: Date | undefined;
  email: string | null;
  phone: string | null;
  company: string | null;
  address: string | null;
  gstin: string | null;
  notes: string | null;
};

// Section 7.4 — [Edit] sheet. Optimistic-lock CONFLICT (Section 6.7)
// surfaces as a refresh banner rather than a silent overwrite.
export function EditClientSheet({ client }: { client: EditableClient }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [amountRupees, setAmountRupees] = React.useState(paiseToRupeesPlain(client.amountPaise));
  const [conflict, setConflict] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const form = useForm<EditClientFormValues>({
    defaultValues: {
      name: client.name,
      service: client.service,
      amountPaise: client.amountPaise,
      nextDueDate: new Date(client.nextDueDate),
      email: client.email,
      phone: client.phone,
      company: client.company,
      address: client.address,
      gstin: client.gstin,
      notes: client.notes,
    },
  });

  function submit(values: EditClientFormValues) {
    setFormError(null);
    setConflict(false);
    startTransition(async () => {
      const payload: UpdateClientInput = {
        version: client.version,
        name: values.name,
        service: values.service,
        amountPaise: values.amountPaise,
        ...(values.nextDueDate ? { nextDueDate: values.nextDueDate } : {}),
        email: values.email,
        phone: values.phone,
        company: values.company,
        address: values.address,
        gstin: values.gstin,
        notes: values.notes,
      };
      const result = await updateClientAction(client.id, payload);
      if (!result.success) {
        if (result.error.code === "CONFLICT") setConflict(true);
        setFormError(result.message);
        return;
      }
      setOpen(false);
      toast.success("Client updated.");
      router.refresh();
    });
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button variant="outline" />}>Edit</SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Edit client</SheetTitle>
          <SheetDescription>
            Changing the amount or due date only affects future billings — past months keep
            their original figures (Section 6.7).
          </SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(submit)} className="grid gap-4 px-4" noValidate>
            {conflict ? (
              <p className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm text-warn">
                This client was updated by someone else. Refresh to see the latest.
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
              name="service"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Service</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
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
                          form.setValue("amountPaise", toPaise(amountRupees || "0"));
                        } catch {
                          setFormError("Enter a valid amount");
                        }
                      }}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="nextDueDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Next due date</FormLabel>
                  <FormControl>
                    <DateFieldIST value={field.value} onChange={field.onChange} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ""} />
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
