import { create } from "zustand";

// Section 3 — Zustand's active-month-context slice. Not persisted via
// localStorage middleware: the cookie (lib/month-context.ts) is the real
// persistence + SSR source of truth, set by setMonthAction; this store
// only mirrors it for instant client-side UI in MonthPicker without prop
// drilling, hydrated from the server-provided monthKey on first render.
type MonthContextState = {
  monthKey: string;
  setMonthKey: (monthKey: string) => void;
};

export const useMonthStore = create<MonthContextState>((set) => ({
  monthKey: "",
  setMonthKey: (monthKey) => set({ monthKey }),
}));
