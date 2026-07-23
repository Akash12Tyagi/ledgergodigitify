"use server";

import { cookies } from "next/headers";

import { DASHBOARD_FROM_COOKIE, DASHBOARD_TO_COOKIE, isValidMonthKey } from "@/lib/dashboard-range-context";

export async function setDashboardRangeAction(from: string, to: string): Promise<void> {
  if (!isValidMonthKey(from) || !isValidMonthKey(to)) return;
  if (from > to) return;

  const cookieStore = await cookies();
  const options = {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax" as const,
    httpOnly: false,
  };
  cookieStore.set(DASHBOARD_FROM_COOKIE, from, options);
  cookieStore.set(DASHBOARD_TO_COOKIE, to, options);
}
