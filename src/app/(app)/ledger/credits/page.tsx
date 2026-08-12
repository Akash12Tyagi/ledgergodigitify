import type { Metadata } from "next";
import { cookies } from "next/headers";

import { PageHeader } from "@/components/shared/PageHeader";
import { DateRangeFilter } from "@/components/shared/DateRangeFilter";
import { CreditsTableView } from "@/features/credits/components/CreditsTableView";
import { listCredits } from "@/server/services/credits.service";
import { requireUser } from "@/server/auth/guards";
import { PERIOD_FROM_COOKIE, PERIOD_TO_COOKIE, resolvePeriodRange } from "@/lib/period-range-context";
import { formatMonthLabel, nowIST, toMonthKey } from "@/lib/dates";
import { resolveDateRange } from "@/lib/date-range";
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

  // Scoped to the app-wide period, so this list and the Overview's Credits
  // card always describe the same span of time.
  const cookieStore = await cookies();
  const { from, to } = resolvePeriodRange(
    cookieStore.get(PERIOD_FROM_COOKIE)?.value,
    cookieStore.get(PERIOD_TO_COOKIE)?.value,
    toMonthKey(nowIST())
  );
  // Exact ?from/?to dates win; with neither, this falls back to the same
  // months the Overview's Credits figure covers.
  const dateRange = resolveDateRange(params.from, params.to, { from, to });

  const result = await listCredits({
    category,
    status,
    page,
    pageSize,
    receivedFrom: dateRange.startUTC,
    receivedTo: dateRange.endUTC,
  });

  return (
    <div>
      <PageHeader
        title="Credits"
        description="Money in that did not come from a client invoice — owner capital, loans, refunds, interest."
        action={
          <DateRangeFilter
            from={dateRange.from}
            to={dateRange.to}
            fallbackLabel={
              from === to
                ? formatMonthLabel(to)
                : `${formatMonthLabel(from)} – ${formatMonthLabel(to)}`
            }
          />
        }
      />
      <CreditsTableView
        rows={result.rows}
        total={result.total}
        page={result.page}
        pageSize={result.pageSize}
        role={actor.role}
      />
    </div>
  );
}
