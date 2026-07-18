// Section 12 — "system default + manual toggle persisted (cookie, so SSR
// renders the right theme — no flash)". Persisted explicitly as a cookie
// (not localStorage) so the root layout can read it server-side and render
// the correct theme class on the very first paint — zero client-side
// detection script, so there is nothing to flash.
export const THEME_COOKIE = "theme";
export type Theme = "light" | "dark";

export function isTheme(value: string | undefined): value is Theme {
  return value === "light" || value === "dark";
}
