"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

// Section 3 — every (app) segment gets an error.tsx with reset + a
// correlation id so a bug report can be tied back to a server log line.
// This is a Client Component (a Next.js requirement for error boundaries),
// so it cannot import the pino logger (server-only) — the server already
// logged this error with the same digest before it reached the client.
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Dashboard segment error", error.digest, error);
  }, [error]);

  return (
    <div className="grid place-items-center gap-3 py-24 text-center">
      <p className="text-sm text-muted-foreground">
        Something went wrong{error.digest ? ` — ref #${error.digest}` : ""}.
      </p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
