"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

// Section 3 — every (app) segment gets an error.tsx with reset + a
// correlation id so a bug report can be tied back to a server log line.
export default function ProfileError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Profile segment error", error.digest, error);
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
