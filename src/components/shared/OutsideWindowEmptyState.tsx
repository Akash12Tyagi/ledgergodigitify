"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/EmptyState";
import { DATE_FROM_PARAM, DATE_TO_PARAM, formatISODateDisplay } from "@/lib/date-range";
import type { OutsideWindowSummary } from "@/types/list";

/**
 * Section 14 edge case 32's empty-FILTERED state, for the lists scoped by a
 * date window.
 *
 * These lists inherit the app-wide month period when no exact dates are
 * chosen, so an entry dated outside it vanishes the moment it is saved —
 * and "No credits yet" is precisely what a failed save would also look
 * like. Naming the range that hid the row, and offering one click to widen
 * to where the rows actually are, is the difference between a filter and a
 * bug report.
 */
export function OutsideWindowEmptyState({
  summary,
  rangeLabel,
  noun,
  nounPlural,
}: {
  summary: OutsideWindowSummary;
  /** What the list is currently scoped to, worded as the picker words it. */
  rangeLabel: string;
  noun: string;
  nounPlural: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const span =
    summary.earliest === summary.latest
      ? `dated ${formatISODateDisplay(summary.earliest)}`
      : `dated between ${formatISODateDisplay(summary.earliest)} and ${formatISODateDisplay(summary.latest)}`;

  function showAll() {
    const params = new URLSearchParams(searchParams.toString());
    params.set(DATE_FROM_PARAM, summary.earliest);
    params.set(DATE_TO_PARAM, summary.latest);
    params.set("page", "1");
    router.push(`${pathname}?${params.toString()}`);
  }

  const one = summary.total === 1;

  return (
    <EmptyState
      title={`No ${nounPlural} in ${rangeLabel}`}
      description={`${summary.total} ${one ? noun : nounPlural} ${one ? "is" : "are"} recorded outside this range, ${span}. Nothing was lost — the list is only narrowed.`}
      action={
        <Button variant="outline" size="sm" onClick={showAll}>
          {one ? `Show the ${noun}` : `Show all ${summary.total} ${nounPlural}`}
        </Button>
      }
    />
  );
}
