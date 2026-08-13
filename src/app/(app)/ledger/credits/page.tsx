import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/PageHeader";
import { DateRangeFilter } from "@/components/shared/DateRangeFilter";
import { CreditsTableView } from "@/features/credits/components/CreditsTableView";
import { listCredits } from "@/server/services/credits.service";
import { requireUser } from "@/server/auth/guards";
import { describeDateWindow, resolveDateRange } from "@/lib/date-range";
import { PAGE_SIZE_DEFAULT } from "@/constants/finance";
import type { CreditCategory } from "@/constants/domain";

export const metadata: Metadata = { title: "Credits — Finance & Ledger" };
export const dynamic = "force-dynamic";

// Section 7.9 — /ledger/credits.
export default async function CreditsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const actor = await requireUser("viewer");

  const page = Math.max(1, Number(params.page ?? "1"));
  const pageSize = Math.max(1, Number(params.pageSize ?? String(PAGE_SIZE_DEFAULT)));
  const category = (params.category as CreditCategory | "all" | undefined) ?? "all";
  const status = (params.status as "active" | "reversed" | "all" | undefined) ?? "active";

  // All time unless ?from/?to narrow it. The list is the record of what was
  // recorded; the Overview's Credits card is what a given month totals, and
  // the two are allowed to describe different spans.
  const dateRange = resolveDateRange(params.from, params.to);

  const result = await listCredits({
    category,
    status,
    page,
    pageSize,
    // Spread, not `undefined`: on All time the keys must be absent, or the
    // repository builds an empty `$gte`/`$lt` that matches nothing.
    ...(dateRange.startUTC ? { receivedFrom: dateRange.startUTC } : {}),
    ...(dateRange.endUTC ? { receivedTo: dateRange.endUTC } : {}),
  });

  // The picker's own wording, reused by the empty state so the two name the
  // same span identically.
  const rangeLabel = describeDateWindow(dateRange.from, dateRange.to);

  return (
    <div>
      <PageHeader
        title="Credits"
        description="Money in that did not come from a client invoice — owner capital, loans, refunds, interest."
        action={<DateRangeFilter from={dateRange.from} to={dateRange.to} />}
      />
      <CreditsTableView
        rows={result.rows}
        total={result.total}
        page={result.page}
        pageSize={result.pageSize}
        role={actor.role}
        rangeLabel={rangeLabel}
        outsideWindow={result.outsideWindow}
      />
    </div>
  );
}
