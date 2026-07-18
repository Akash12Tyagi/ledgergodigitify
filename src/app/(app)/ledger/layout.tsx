"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

// Section 7 — /ledger's sub-tab bar.
const LEDGER_TABS = [
  { href: "/ledger/overview", label: "Overview" },
  { href: "/ledger/dues", label: "Dues" },
  { href: "/ledger/accounts", label: "Accounts" },
  { href: "/ledger/expenses", label: "Expenses" },
  { href: "/ledger/credits", label: "Credits" },
];

export default function LedgerLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div>
      <nav className="mb-6 flex gap-1 border-b">
        {LEDGER_TABS.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "border-b-2 px-3 py-2 text-sm font-medium",
                active
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
