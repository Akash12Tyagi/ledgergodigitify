"use server";

import { cookies } from "next/headers";

import { MONTH_COOKIE, isValidMonthKey } from "@/lib/month-context";

export async function setMonthAction(monthKey: string): Promise<void> {
  if (!isValidMonthKey(monthKey)) return;
  const cookieStore = await cookies();
  cookieStore.set(MONTH_COOKIE, monthKey, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    httpOnly: false,
  });
}
