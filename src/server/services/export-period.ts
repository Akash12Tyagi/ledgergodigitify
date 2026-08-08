import { cookies } from "next/headers";

import { PERIOD_FROM_COOKIE, PERIOD_TO_COOKIE, resolvePeriodRange } from "@/lib/period-range-context";
import { monthRangeToUtc, nowIST, toMonthKey } from "@/lib/dates";

/**
 * The app-wide period, read the same way every page reads it.
 *
 * Exports promise "the rows you see on screen, in a file" (Section 7.13),
 * and the screens are now period-scoped — so the export routes have to read
 * the same cookie pair, or a download would silently contain rows from
 * outside the period the user was looking at.
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
