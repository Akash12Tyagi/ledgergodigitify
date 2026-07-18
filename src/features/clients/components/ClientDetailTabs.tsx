import Link from "next/link";

import { cn } from "@/lib/utils";

const TABS = [
  { value: "current", label: "Current" },
  { value: "history", label: "History" },
  { value: "dues", label: "Dues" },
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
