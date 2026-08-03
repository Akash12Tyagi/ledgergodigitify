import { create } from "zustand";

// Section 15/M8 hardening pass — the off-canvas nav drawer shown below
// `md:` (AppSidebar/AppTopbar). Deliberately NOT persisted (unlike
// sidebar-store.ts's collapsed state): the drawer should always start
// closed on a fresh page load, never reopen because a previous session
// left it open.
type MobileNavState = {
  open: boolean;
  setOpen: (open: boolean) => void;
};

export const useMobileNavStore = create<MobileNavState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
