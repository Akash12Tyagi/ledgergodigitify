"use server";

import { cookies } from "next/headers";

import {
  ALL_TIME_COOKIE_VALUE,
  PERIOD_FROM_COOKIE,
  PERIOD_TO_COOKIE,
  isValidMonthKey,
} from "@/lib/period-range-context";

const COOKIE_OPTIONS = {
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
  sameSite: "lax" as const,
  httpOnly: false,
};

/** Persists the app-wide reporting period. Rejects malformed or inverted
 * ranges rather than storing them, so a bad value can never make every
 * screen render an empty period. */
export async function setPeriodRangeAction(from: string, to: string): Promise<void> {
  if (!isValidMonthKey(from) || !isValidMonthKey(to)) return;
  if (from > to) return;

  const cookieStore = await cookies();
  cookieStore.set(PERIOD_FROM_COOKIE, from, COOKIE_OPTIONS);
  cookieStore.set(PERIOD_TO_COOKIE, to, COOKIE_OPTIONS);
}

/** Switches every period-scoped screen to all time. Written as an explicit
 * sentinel rather than by deleting the cookies, so "I chose all time" and
 * "I have never touched the picker" stay distinguishable — even though both
 * currently resolve the same way. */
export async function setPeriodAllTimeAction(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(PERIOD_FROM_COOKIE, ALL_TIME_COOKIE_VALUE, COOKIE_OPTIONS);
  cookieStore.set(PERIOD_TO_COOKIE, ALL_TIME_COOKIE_VALUE, COOKIE_OPTIONS);
}
