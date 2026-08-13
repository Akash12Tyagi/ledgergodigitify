import { cookies } from "next/headers";

import {
  PERIOD_FROM_COOKIE,
  PERIOD_TO_COOKIE,
  resolvePeriodRange,
} from "@/lib/period-range-context";
import { nowIST, toMonthKey } from "@/lib/dates";

/**
 * The app-wide period, read the same way every page reads it.
 *
 * Exports promise "the rows you see on screen, in a file" (Section 7.13).
 * Only the TRANSACTIONS export still uses this, because the screen it
 * mirrors — the Ledger Overview's transaction list — is still scoped to the
 * month period. The credits and expenses exports resolve their window from
 * their own ?from/?to and default to all time, exactly as those lists do
 * (lib/date-range.ts); reading this cookie there would have put fewer rows
 * in the file than the list was showing.
 *
 * `from` may be the all-time floor ("0000-01"); it is only ever used as a
 * monthKey query bound, never turned into a date or shown to anyone —
 * `slug` is what names the file.
 */
export async function currentExportPeriod(): Promise<{
  from: string;
  to: string;
  slug: string;
}> {
  const cookieStore = await cookies();
  const period = resolvePeriodRange(
    cookieStore.get(PERIOD_FROM_COOKIE)?.value,
    cookieStore.get(PERIOD_TO_COOKIE)?.value,
    toMonthKey(nowIST())
  );

  const slug = period.isAllTime
    ? "all-time"
    : period.from === period.to
      ? period.from
      : `${period.from}_${period.to}`;

  return { from: period.from, to: period.to, slug };
}
