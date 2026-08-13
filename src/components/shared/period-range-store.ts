import { create } from "zustand";

/**
 * Mirrors the app-wide period cookies (lib/period-range-context.ts) so
 * PeriodRangePicker can update its own label instantly, before the server
 * round-trip that re-renders the page's figures.
 *
 * `null` means "nothing chosen in this tab yet" — the picker then falls back
 * to the values the server rendered with, rather than to a hardcoded month.
 */
export type PeriodSelection = { from: string; to: string; isAllTime: boolean };

type PeriodRangeState = {
  period: PeriodSelection | null;
  setPeriod: (period: PeriodSelection) => void;
};

export const usePeriodRangeStore = create<PeriodRangeState>((set) => ({
  period: null,
  setPeriod: (period) => set({ period }),
}));
