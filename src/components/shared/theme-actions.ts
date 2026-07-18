"use server";

import { cookies } from "next/headers";

import { isTheme, THEME_COOKIE, type Theme } from "@/lib/theme";

export async function setThemeAction(theme: Theme): Promise<void> {
  if (!isTheme(theme)) return;
  const cookieStore = await cookies();
  cookieStore.set(THEME_COOKIE, theme, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    httpOnly: false,
  });
}
