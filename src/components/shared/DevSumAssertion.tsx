/**
 * Section 4.6/15 — the sibling-list rule's runtime proof: an aggregate
 * card's value must equal the sum of the drill-down list it opens onto,
 * not just by convention but asserted numerically at runtime whenever a
 * dev server renders the pair. A pure server component (no client JS, no
 * network round trip — both numbers are already in scope from the same
 * page's data fetch) that is a complete no-op outside development, so it
 * can never affect production behavior, bundle size, or performance
 * (Section 9).
 */
export function DevSumAssertion({
  label,
  expectedPaise,
  actualPaise,
}: {
  /** What this assertion is checking, for the error message only. */
  label: string;
  /** The KPI/DrilldownCard's displayed value. */
  expectedPaise: number;
  /** The true sum of every row in the sibling list (Section 4.6 — the
   * FULL filtered total, not just the current page). */
  actualPaise: number;
}) {
  if (process.env.NODE_ENV !== "development") return null;

  if (expectedPaise !== actualPaise) {
    throw new Error(
      `[DEV ASSERTION — Section 4.6 sibling-list rule] "${label}": card shows ${expectedPaise} paise but its drill-down list sums to ${actualPaise} paise. These must be numerically identical.`
    );
  }

  return null;
}
