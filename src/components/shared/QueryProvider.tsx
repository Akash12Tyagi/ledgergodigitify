"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Section 1.3/9 — TanStack Query is used for exactly one thing in this
// app: the topbar bell's 60s poll of /api/notifications/poll. Every other
// page fetches data via a direct in-process RSC service call, never a
// client-side query.
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(() => new QueryClient());
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
