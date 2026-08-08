"use server";

import { cookies } from "next/headers";

import { PERIOD_FROM_COOKIE, PERIOD_TO_COOKIE, isValidMonthKey } from "@/lib/period-range-context";

/** Persists the app-wide reporting period. Rejects malformed or inverted
 * ranges rather than storing them, so a bad value can never make every
 * screen render an empty period. */
export async function setPeriodRangeAction(from: string, to: string): Promise<void> {
  if (!isValidMonthKey(from) || !isValidMonthKey(to)) return;
  if (from > to) return;

  const cookieStore = await cookies();
  const options = {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax" as const,
    httpOnly: false,
  };
  cookieStore.set(PERIOD_FROM_COOKIE, from, options);
  cookieStore.set(PERIOD_TO_COOKIE, to, options);
}
