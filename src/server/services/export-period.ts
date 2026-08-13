import { cookies } from "next/headers";

import { PERIOD_FROM_COOKIE, PERIOD_TO_COOKIE, resolvePeriodRange } from "@/lib/period-range-context";
import { monthRangeToUtc, nowIST, toMonthKey } from "@/lib/dates";

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
 */
export async function currentExportPeriod(): Promise<{
  from: string;
  to: string;
  startUTC: Date;
  endUTC: Date;
}> {
  const cookieStore = await cookies();
  const { from, to } = resolvePeriodRange(
    cookieStore.get(PERIOD_FROM_COOKIE)?.value,
    cookieStore.get(PERIOD_TO_COOKIE)?.value,
    toMonthKey(nowIST())
  );
  return { from, to, ...monthRangeToUtc(from, to) };
}
