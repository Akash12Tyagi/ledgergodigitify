import { create } from "zustand";
import { persist } from "zustand/middleware";

// Section 3 — Zustand used ONLY for: sidebar collapsed state, ⌘K palette
// open state, active month context. This is the sidebar slice.
type SidebarState = {
  collapsed: boolean;
  toggle: () => void;
};

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set) => ({
      collapsed: false,
      toggle: () => set((state) => ({ collapsed: !state.collapsed })),
    }),
    { name: "sidebar-collapsed" }
  )
);
