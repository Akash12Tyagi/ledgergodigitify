import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

// Section 10.4 — presence-level check only (no DB call, no Better Auth
// instance construction here). The (app)/layout.tsx server guard
// (server/auth/guards.ts#requireUser) re-validates the session
// authoritatively on every request; this file only decides whether to
// bother rendering the app shell at all.
//
// Next.js 16 deprecated `middleware.ts` in favor of `proxy.ts` (the
// `middleware` file convention and named export are both deprecated — see
// AGENTS.md / node_modules/next/dist/docs/.../upgrading/version-16.md).
// This intentionally uses the new convention/name; it is the same feature
// Section 10.4 describes, renamed by the framework, not a scope change.
export function proxy(request: NextRequest) {
  const hasSession = Boolean(getSessionCookie(request));

  if (!hasSession) {
    const loginUrl = new URL("/login", request.url);
    // Open-redirect guard (Section 10.14 / 14.38): only ever a same-origin
    // path, never an absolute URL, so returnTo can't be abused to redirect
    // off-site after login.
    loginUrl.searchParams.set("returnTo", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!login|api/auth|api/health|api/cron|_next/static|_next/image|favicon.ico).*)",
  ],
};
