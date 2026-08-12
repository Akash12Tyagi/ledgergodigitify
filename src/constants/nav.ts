import type { LucideIcon } from "lucide-react";
import {
  Bell,
  CalendarClock,
  ChartColumn,
  FileText,
  HandCoins,
  LayoutDashboard,
  PiggyBank,
  Receipt,
  Repeat,
  ScrollText,
  Settings,
  Users,
  Wallet,
} from "lucide-react";

import type { UserRole } from "@/constants/roles";

// Section 7 — global shell sidebar. `minRole` mirrors the Section 1.2
// permission matrix (rank-based); items below a user's role are hidden
// (cosmetic only — server guards are the real enforcement, Section 1.2).
export type NavItem = {
  label: string;
  href: string;
  minRole: UserRole;
  icon: LucideIcon;
  /**
   * Names a live counter the shell resolves and renders as a pill. Only
   * counts that mean "someone has to act" belong here — a badge that never
   * reaches zero is decoration, and stops being read.
   */
  badge?: "pendingExpenses";
  /** Extra paths that should light this item up, for sections whose child
   * routes don't sit under `href`. */
  matchPrefixes?: string[];
};

export type NavGroup = {
  /** null renders the items flush, with no section heading. */
  label: string | null;
  items: NavItem[];
};

/**
 * Grouped rather than flat.
 *
 * The flat list had one "Ledger" entry pointing at the Overview, which made
 * every other money screen — Accounts, Dues, Billed, Credits, and the
 * Transfer action living inside Accounts — reachable only by knowing it was
 * there. Naming each destination is the whole point: the sidebar should be
 * the inventory of what this app does.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { label: "Dashboard", href: "/dashboard", minRole: "viewer", icon: LayoutDashboard },
      { label: "Clients", href: "/clients", minRole: "viewer", icon: Users },
    ],
  },
  {
    label: "Ledger",
    items: [
      { label: "Overview", href: "/ledger/overview", minRole: "viewer", icon: ChartColumn },
      { label: "Accounts", href: "/ledger/accounts", minRole: "viewer", icon: Wallet },
      { label: "Dues", href: "/ledger/dues", minRole: "viewer", icon: CalendarClock },
      { label: "Billed", href: "/ledger/billed", minRole: "viewer", icon: FileText },
      {
        label: "Expenses",
        href: "/ledger/expenses",
        minRole: "viewer",
        icon: Receipt,
        badge: "pendingExpenses",
      },
      { label: "Recurring", href: "/ledger/recurring", minRole: "viewer", icon: Repeat },
      { label: "Credits", href: "/ledger/credits", minRole: "viewer", icon: PiggyBank },
      { label: "Borrowers", href: "/ledger/borrowers", minRole: "viewer", icon: HandCoins },
    ],
  },
  {
    label: null,
    items: [
      { label: "Notifications", href: "/notifications", minRole: "viewer", icon: Bell },
      { label: "Audit", href: "/audit", minRole: "admin", icon: ScrollText },
      { label: "Settings", href: "/settings", minRole: "owner", icon: Settings },
    ],
  },
];
