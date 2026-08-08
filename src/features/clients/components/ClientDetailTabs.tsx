import Link from "next/link";

import { cn } from "@/lib/utils";

// "Dues" is the default and the place work actually happens — every open
// period with its own Record Payment button. The old "Current" tab showed
// only the calendar month's billing, which for a 20th-to-20th client was
// frequently nothing at all; its payment trail now lives per-period under
// History.
const TABS = [
  { value: "dues", label: "Dues" },
  { value: "history", label: "History" },
  { value: "activity", label: "Activity" },
] as const;

// Section 7.4 — ?tab= lives in the URL (Section 8.4), so tabs are
// shareable/back-button-correct without any client-side state.
export function ClientDetailTabs({ clientId, active }: { clientId: string; active: string }) {
  return (
    <div className="mb-4 flex gap-1 border-b">
      {TABS.map((tab) => (
        <Link
          key={tab.value}
          href={`/clients/${clientId}?tab=${tab.value}`}
          className={cn(
            "border-b-2 px-3 py-2 text-sm font-medium",
            active === tab.value
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
