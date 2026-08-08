import type { Metadata } from "next";
import { cookies } from "next/headers";

import { PageHeader } from "@/components/shared/PageHeader";
import { PeriodRangePicker } from "@/components/shared/PeriodRangePicker";
import { CreditsTableView } from "@/features/credits/components/CreditsTableView";
import { listCredits } from "@/server/services/credits.service";
import { getSettings } from "@/server/services/settings.service";
import { requireUser } from "@/server/auth/guards";
import { PERIOD_FROM_COOKIE, PERIOD_TO_COOKIE, resolvePeriodRange } from "@/lib/period-range-context";
import { monthRangeToUtc, nowIST, toMonthKey } from "@/lib/dates";
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
  const { startUTC, endUTC } = monthRangeToUtc(from, to);

  const [result, settings] = await Promise.all([
    listCredits({ category, status, page, pageSize, receivedFrom: startUTC, receivedTo: endUTC }),
    getSettings(),
  ]);

  return (
    <div>
      <PageHeader
        title="Credits"
        action={
          <PeriodRangePicker
            fromMonthKey={from}
            toMonthKey={to}
            minMonthKey={settings.goLiveDate ? toMonthKey(settings.goLiveDate) : undefined}
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
