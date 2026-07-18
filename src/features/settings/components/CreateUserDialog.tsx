"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { createUserSchema, type CreateUserInput } from "@/schemas/user.schema";
import { USER_ROLES } from "@/constants/roles";
import { createUserAction } from "@/features/settings/actions";

function makeDefaults(): CreateUserInput {
  return { name: "", email: "", role: "staff" };
}

// Section 6.10/11 — the owner-facing "add user" flow. The temporary
// password is shown exactly once — there is no way to retrieve it again
// after this dialog closes (Section 10.1: never stored in plaintext).
export function CreateUserDialog() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [created, setCreated] = React.useState<{ name: string; email: string; temporaryPassword: string } | null>(
    null
  );
  const [copied, setCopied] = React.useState(false);

  const form = useForm<CreateUserInput>({
    resolver: zodResolver(createUserSchema),
    defaultValues: makeDefaults(),
  });

  function resetForOpen() {
    setCreated(null);
    setFormError(null);
    setCopied(false);
    form.reset(makeDefaults());
  }

  function submit(values: CreateUserInput) {
    setFormError(null);
    startTransition(async () => {
      const result = await createUserAction(values);
      if (!result.success) {
        setFormError(result.message);
        return;
      }
      setCreated({
        name: result.data.user.name,
        email: result.data.user.email,
        temporaryPassword: result.data.temporaryPassword,
      });
      router.refresh();
    });
  }

  async function copyPassword() {
    if (!created) return;
    await navigator.clipboard.writeText(created.temporaryPassword);
    setCopied(true);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) resetForOpen();
      }}
    >
      <DialogTrigger render={<Button />}>New User</DialogTrigger>
      <DialogContent>
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>{created.name} was added</DialogTitle>
              <DialogDescription>
                Share this temporary password with them directly — it will not be shown again. They
                must change it on first login.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <p className="text-sm text-muted-foreground">{created.email}</p>
              <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3">
                <code className="flex-1 break-all text-sm">{created.temporaryPassword}</code>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label="Copy temporary password"
                  onClick={() => void copyPassword()}
                >
                  <Copy className="size-4" />
                </Button>
              </div>
              {copied ? <p className="text-xs text-money-in">Copied.</p> : null}
            </div>
            <DialogFooter>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Add a user</DialogTitle>
              <DialogDescription>
                A temporary password is generated and shown once — no email is sent.
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(submit)} className="grid gap-4" noValidate>
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
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input type="email" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="role"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Role</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {USER_ROLES.map((r) => (
                            <SelectItem key={r} value={r} className="capitalize">
                              {r}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {formError ? (
                  <p role="alert" className="text-sm text-destructive">
                    {formError}
                  </p>
                ) : null}

                <DialogFooter>
                  <Button type="submit" disabled={pending}>
                    {pending ? "Creating…" : "Add user"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
