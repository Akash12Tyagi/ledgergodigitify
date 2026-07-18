"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { UserCog } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { initials } from "@/lib/utils";
import { updateProfileAction } from "@/features/profile/actions";
import type { ProfileData } from "@/server/services/profile.service";

const accountSettingsFormSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(80),
  phone: z
    .string()
    .max(20, "Phone number is too long")
    .regex(/^[0-9+\-\s()]*$/, "Enter a valid phone number"),
  image: z.string().max(2048).refine((value) => value === "" || z.url().safeParse(value).success, {
    message: "Enter a valid image URL",
  }),
});
type AccountSettingsFormValues = z.infer<typeof accountSettingsFormSchema>;

function toFormValues(profile: ProfileData): AccountSettingsFormValues {
  return { name: profile.name, phone: profile.phone ?? "", image: profile.image ?? "" };
}

// Section 7 Profile page — "Account Settings". Email/role/status are
// display-only here (Section 1.2: identity/role stay owner-controlled via
// /settings/users) — only name/phone/avatar are self-editable.
export function AccountSettingsForm({ profile }: { profile: ProfileData }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  const form = useForm<AccountSettingsFormValues>({
    resolver: zodResolver(accountSettingsFormSchema),
    defaultValues: toFormValues(profile),
  });

  const watchedImage = form.watch("image");
  const watchedName = form.watch("name");

  function submit(values: AccountSettingsFormValues) {
    startTransition(async () => {
      const result = await updateProfileAction({
        name: values.name,
        phone: values.phone.trim() === "" ? null : values.phone.trim(),
        image: values.image.trim() === "" ? null : values.image.trim(),
      });
      if (!result.success) {
        for (const [field, message] of Object.entries(result.error.fields ?? {})) {
          if (field === "name" || field === "phone" || field === "image") {
            form.setError(field, { message });
          }
        }
        toast.error(result.message);
        return;
      }
      toast.success("Profile updated.");
      form.reset(toFormValues(result.data));
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 text-sm font-medium">
          <UserCog className="size-4" />
          Account Settings
        </CardTitle>
        <CardDescription>Update your name, phone, and profile picture.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(submit)} className="grid gap-4" noValidate>
            <div className="flex items-center gap-3">
              <Avatar className="size-12">
                {watchedImage ? <AvatarImage src={watchedImage} alt={watchedName} /> : null}
                <AvatarFallback>{initials(watchedName || profile.name)}</AvatarFallback>
              </Avatar>
              <FormField
                control={form.control}
                name="image"
                render={({ field }) => (
                  <FormItem className="flex-1">
                    <FormLabel>Profile picture URL</FormLabel>
                    <FormControl>
                      <Input placeholder="https://…" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Full name</FormLabel>
                  <FormControl>
                    <Input autoComplete="name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="profile-email">Email</Label>
                <Input id="profile-email" value={profile.email} disabled readOnly />
              </div>
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone (optional)</FormLabel>
                    <FormControl>
                      <Input type="tel" autoComplete="tel" placeholder="+91 98765 43210" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Button type="submit" disabled={pending} className="w-fit">
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
