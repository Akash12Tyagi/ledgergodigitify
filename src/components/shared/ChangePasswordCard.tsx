"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { changePasswordSchema } from "@/schemas/auth.schema";
import { changePasswordAction } from "@/features/auth/actions";
import { PASSWORD_MIN_LENGTH } from "@/constants/finance";

// Client-only: `confirmPassword` never reaches the server (Section 8.2's
// changePasswordSchema is the one the server trusts) — this just adds the
// "passwords must match" UX check on top of it.
const changePasswordFormSchema = changePasswordSchema
  .extend({ confirmPassword: z.string().min(1, "Confirm your new password") })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
type ChangePasswordFormValues = z.infer<typeof changePasswordFormSchema>;

function emptyValues(): ChangePasswordFormValues {
  return { currentPassword: "", newPassword: "", confirmPassword: "" };
}

// Section 7 Profile "Security" section — the only place password change now
// lives (the old standalone /settings/change-password screen is gone).
// `changePasswordAction` (features/auth/actions.ts) already revokes every
// other session via Better Auth's revokeSessionsOnPasswordReset.
export function ChangePasswordCard() {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  const form = useForm<ChangePasswordFormValues>({
    resolver: zodResolver(changePasswordFormSchema),
    defaultValues: emptyValues(),
  });

  function submit(values: ChangePasswordFormValues) {
    startTransition(async () => {
      const result = await changePasswordAction({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      if (!result.success) {
        if (result.error.fields?.currentPassword) {
          form.setError("currentPassword", { message: result.error.fields.currentPassword });
        }
        if (result.error.fields?.password) {
          form.setError("newPassword", { message: result.error.fields.password });
        }
        toast.error(result.message);
        return;
      }
      toast.success("Password changed — your other sessions have been signed out.");
      form.reset(emptyValues());
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 text-sm font-medium">
          <KeyRound className="size-4" />
          Security
        </CardTitle>
        <CardDescription>
          Change your password. You&apos;ll stay signed in on this device; every other session is
          signed out immediately.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(submit)} className="grid gap-4" noValidate>
            <FormField
              control={form.control}
              name="currentPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Current password</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="current-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="newPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>New password</FormLabel>
                    <FormControl>
                      <Input type="password" autoComplete="new-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm new password</FormLabel>
                    <FormControl>
                      <Input type="password" autoComplete="new-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              At least {PASSWORD_MIN_LENGTH} characters, and not easy to guess.
            </p>
            <Button type="submit" disabled={pending} className="w-fit">
              {pending ? "Changing…" : "Change password"}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
