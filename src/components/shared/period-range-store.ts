import { create } from "zustand";

// Mirrors the app-wide period cookies (lib/period-range-context.ts) so
// PeriodRangePicker can update its own label instantly, before the server
// round-trip that re-renders the page's figures.
type PeriodRangeState = {
  from: string;
  to: string;
  setRange: (from: string, to: string) => void;
};

export const usePeriodRangeStore = create<PeriodRangeState>((set) => ({
  from: "",
  to: "",
  setRange: (from, to) => set({ from, to }),
}));
