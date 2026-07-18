import type { Metadata } from "next";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "@/features/auth/components/LoginForm";

export const metadata: Metadata = { title: "Sign in — Finance & Ledger" };

// Section 7.14 — centered card, no public signup page exists. `returnTo` is
// validated again server-side inside loginAction's Zod schema (Section
// 10.14) — trusting it here is only for pre-filling the redirect target.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { returnTo } = await searchParams;
  const safeReturnTo = returnTo && /^\/(?!\/)/.test(returnTo) ? returnTo : undefined;

  return (
    <div className="flex min-h-screen flex-1 items-center justify-center bg-muted/30 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Sign in</CardTitle>
          <CardDescription>Company finance & ledger system.</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm returnTo={safeReturnTo} />
        </CardContent>
      </Card>
    </div>
  );
}
