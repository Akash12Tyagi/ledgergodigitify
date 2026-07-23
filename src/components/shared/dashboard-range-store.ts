import { create } from "zustand";

// Mirrors the Dashboard's from/to cookies (lib/dashboard-range-context.ts)
// for instant client-side UI in DashboardRangePicker, same pattern as
// components/shared/month-store.ts.
type DashboardRangeState = {
  from: string;
  to: string;
  setRange: (from: string, to: string) => void;
};

export const useDashboardRangeStore = create<DashboardRangeState>((set) => ({
  from: "",
  to: "",
  setRange: (from, to) => set({ from, to }),
}));
