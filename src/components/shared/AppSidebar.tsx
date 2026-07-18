"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronsLeft, ChevronsRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { NAV_ITEMS } from "@/constants/nav";
import { ROLE_RANK, type UserRole } from "@/constants/roles";
import { useSidebarStore } from "@/components/shared/sidebar-store";

// Section 7 — left sidebar, 240px collapsible to 64px, state in Zustand.
// Hiding items here is cosmetic only (Section 1.2) — every route/action is
// re-checked server-side regardless of what the sidebar shows.
export function AppSidebar({ role }: { role: UserRole }) {
  const pathname = usePathname();
  const { collapsed, toggle } = useSidebarStore();
  const visibleItems = NAV_ITEMS.filter((item) => ROLE_RANK[role] >= ROLE_RANK[item.minRole]);

  return (
    <aside
      className={cn(
        "flex h-screen flex-col border-r bg-sidebar text-sidebar-foreground transition-[width] duration-200",
        collapsed ? "w-16" : "w-60"
      )}
    >
      <div className="flex h-14 items-center justify-between px-3">
        {!collapsed ? (
          <span className="truncate text-sm font-semibold">Finance & Ledger</span>
        ) : null}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={toggle}
        >
          {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
        </Button>
      </div>
      <nav className="flex-1 space-y-1 px-2">
        {visibleItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex h-9 items-center rounded-lg px-2.5 text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                collapsed && "justify-center px-0"
              )}
              title={collapsed ? item.label : undefined}
            >
              {collapsed ? item.label.slice(0, 1) : item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
