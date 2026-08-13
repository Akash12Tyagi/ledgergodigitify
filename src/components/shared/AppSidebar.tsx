"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronsLeft, ChevronsRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { NAV_GROUPS, type NavGroup, type NavItem } from "@/constants/nav";
import { ROLE_RANK, type UserRole } from "@/constants/roles";
import { useSidebarStore } from "@/components/shared/sidebar-store";
import { useMobileNavStore } from "@/components/shared/mobile-nav-store";

export type NavBadgeCounts = { pendingExpenses?: number };

/**
 * `/ledger/accounts` must not stay lit while `/ledger/accounts/xyz` is open
 * — it must — but `/ledger` prefixes are close enough that a naive
 * `startsWith` would light two items at once (e.g. an item at `/ledger` and
 * one at `/ledger/expenses`). Matching on a trailing slash keeps children
 * highlighted without letting siblings collide.
 */
function isActive(pathname: string, item: NavItem): boolean {
  const candidates = [item.href, ...(item.matchPrefixes ?? [])];
  return candidates.some((href) => pathname === href || pathname.startsWith(`${href}/`));
}

function NavBadge({ count }: { count: number }) {
  return (
    <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-warn/15 px-1.5 text-xs font-medium tabular-nums text-warn">
      {count > 99 ? "99+" : count}
    </span>
  );
}

// Shared between the desktop rail and the mobile drawer — the only
// difference is which chrome wraps it (fixed-width <aside> vs. a Sheet).
function NavLinks({
  groups,
  collapsed,
  badges,
  onNavigate = () => {},
}: {
  groups: NavGroup[];
  collapsed: boolean;
  badges: NavBadgeCounts;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav className="flex-1 overflow-y-auto px-2 pb-4">
      {groups.map((group, groupIndex) => (
        <div key={group.label ?? `group-${groupIndex}`} className={groupIndex > 0 ? "mt-4" : ""}>
          {group.label && !collapsed ? (
            <p className="px-2.5 pb-1 text-[11px] font-semibold tracking-wide text-sidebar-foreground/45 uppercase">
              {group.label}
            </p>
          ) : null}
          {/* Collapsed, the heading text would not fit, so the grouping is
              carried by a rule instead of disappearing entirely. */}
          {group.label && collapsed ? <div className="mx-2 mb-1 border-t" /> : null}

          <div className="space-y-0.5">
            {group.items.map((item) => {
              const active = isActive(pathname, item);
              const Icon = item.icon;
              const badgeCount = item.badge ? (badges[item.badge] ?? 0) : 0;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    collapsed && "justify-center px-0"
                  )}
                  title={collapsed ? item.label : undefined}
                >
                  <span className="relative flex shrink-0 items-center">
                    <Icon className="size-4" aria-hidden="true" />
                    {/* Collapsed there is no room for a number, but the
                        queue still has to announce itself — a dot does. */}
                    {collapsed && badgeCount > 0 ? (
                      <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-warn" />
                    ) : null}
                  </span>
                  {collapsed ? (
                    <span className="sr-only">{item.label}</span>
                  ) : (
                    <>
                      <span className="truncate">{item.label}</span>
                      {badgeCount > 0 ? <NavBadge count={badgeCount} /> : null}
                    </>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

// Section 7 — left sidebar, 240px collapsible to 64px, state in Zustand.
// Hiding items here is cosmetic only (Section 1.2) — every route/action is
// re-checked server-side regardless of what the sidebar shows.
//
// Section 15/M8 hardening pass — below `md:` the fixed-width rail is
// replaced by an off-canvas drawer (mobile-nav-store.ts), opened via
// AppTopbar's hamburger button, reusing the existing Sheet primitive
// rather than a bespoke mobile nav component.
export function AppSidebar({
  role,
  badges = {},
}: {
  role: UserRole;
  /** Resolved server-side in the layout — the sidebar itself never queries. */
  badges?: NavBadgeCounts;
}) {
  const { collapsed, toggle } = useSidebarStore();
  const { open, setOpen } = useMobileNavStore();

  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => ROLE_RANK[role] >= ROLE_RANK[item.minRole]),
  })).filter((group) => group.items.length > 0);

  return (
    <>
      <aside
        className={cn(
          "hidden h-screen flex-col border-r bg-sidebar text-sidebar-foreground transition-[width] duration-200 md:flex",
          collapsed ? "w-16" : "w-60"
        )}
      >
        <div className="flex h-14 shrink-0 items-center justify-between px-3">
          {!collapsed ? (
            <span className="truncate text-sm font-semibold">Finance &amp; Ledger</span>
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
        <NavLinks groups={visibleGroups} collapsed={collapsed} badges={badges} />
      </aside>

      <Sheet open={open} onOpenChange={setOpen}>
        {/* The nav does its own scrolling, so the sheet body only has to
            stop adding gaps between the header and it. */}
        <SheetContent side="left" className="p-0 md:hidden" bodyClassName="gap-0">
          <div className="flex h-14 shrink-0 items-center px-3">
            <SheetTitle className="truncate text-sm font-semibold">Finance &amp; Ledger</SheetTitle>
          </div>
          <NavLinks
            groups={visibleGroups}
            collapsed={false}
            badges={badges}
            onNavigate={() => setOpen(false)}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}
