import { redirect } from "next/navigation";

// Section 1.1 — `/` → redirect to `/dashboard`. The proxy (Section 10.4)
// already gates access; this is only reachable when authenticated.
export default function RootPage() {
  redirect("/dashboard");
}
