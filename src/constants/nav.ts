import type { UserRole } from "@/constants/roles";

// Section 7 — global shell sidebar. `minRole` mirrors the Section 1.2
// permission matrix (rank-based); items below a user's role are hidden
// (cosmetic only — server guards are the real enforcement, Section 1.2).
export type NavItem = {
  label: string;
  href: string;
  minRole: UserRole;
};

export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", minRole: "viewer" },
  { label: "Clients", href: "/clients", minRole: "viewer" },
  { label: "Ledger", href: "/ledger/overview", minRole: "viewer" },
  { label: "Notifications", href: "/notifications", minRole: "viewer" },
  { label: "Audit", href: "/audit", minRole: "admin" },
  { label: "Settings", href: "/settings", minRole: "owner" },
];
