"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

// Root-level boundary — catches errors thrown outside every leaf route's
// own error.tsx, e.g. inside (app)/layout.tsx (the auth guard) or on
// /login, which would otherwise fall through to Next's unstyled default.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Root segment error", error.digest, error);
  }, [error]);

  return (
    <div className="grid h-screen place-items-center gap-3 text-center">
      <div>
        <p className="text-lg font-semibold">Something went wrong</p>
        <p className="text-sm text-muted-foreground">
          {error.digest ? `Reference #${error.digest}` : "Please try again."}
        </p>
      </div>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
