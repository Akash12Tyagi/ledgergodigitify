import { AlertTriangle } from "lucide-react";

/**
 * Section 4.3/14 — shown instead of the money figures whenever
 * closing !== opening + net for the requested range. Never renders
 * alongside real numbers (the caller must check `reconciliationError` and
 * render ONLY this, per MonthOverview's own doc comment), so the app never
 * shows a figure that might be wrong.
 */
export function ReconciliationBanner() {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-money-out/40 bg-money-out/10 p-4 text-sm text-money-out">
      <AlertTriangle aria-hidden="true" className="size-5 shrink-0" />
      <div>
        <p className="font-medium">Reconciliation error</p>
        <p className="text-money-out/90">
          The ledger doesn&apos;t balance for this period. Figures are hidden until this is
          resolved — check Settings → Reconciliation.
        </p>
      </div>
    </div>
  );
}
