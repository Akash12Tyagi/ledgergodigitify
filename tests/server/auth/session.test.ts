import { afterEach, describe, expect, it, vi } from "vitest";

import { getAuth } from "@/server/auth/auth";
import { SESSION_MAX_AGE_S } from "@/constants/finance";
import { seedUser, clearAllCollections } from "../../helpers/seed-user";
import { cookieHeaderFromResponse } from "../../helpers/auth-session";

const PASSWORD = "Correct-Horse-Battery-Staple-9";

// Section 11 — the "no random logout" acceptance tests. T1/T2/T3 are
// mechanically verifiable here (session math + cookie attributes). T5
// exercises a generic Server-Action-retry-after-relogin wrapper that is
// UI/E2E infrastructure spanning every mutating form, not just login —
// tracked in docs/IMPLEMENTATION_PLAN.md and built in Section 15's
// Playwright suite once the first such form exists (M3), not here.
describe("Section 11 session config (T1, T2, T3)", () => {
  afterEach(async () => {
    await clearAllCollections();
    vi.useRealTimers();
  });

  it("T2 — the session cookie is persistent with Max-Age == SESSION_MAX_AGE_S, not a browser-session cookie", async () => {
    const user = await seedUser({
      name: "Cookie User",
      email: `cookie-${Date.now()}@example.com`,
      password: PASSWORD,
      role: "staff",
    });

    const auth = await getAuth();
    const response = (await auth.api.signInEmail({
      body: { email: user.email, password: PASSWORD },
      asResponse: true,
    })) as Response;

    const setCookie =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie().join(" | ")
        : (response.headers.get("set-cookie") ?? "");

    expect(setCookie).toMatch(/session_token/i);
    const maxAgeMatch = setCookie.match(/Max-Age=(\d+)/i);
    expect(maxAgeMatch).not.toBeNull();
    // Allow a small tolerance for the roll-up between session expiresIn and
    // cookie maxAge computation.
    expect(Number(maxAgeMatch?.[1])).toBeGreaterThan(SESSION_MAX_AGE_S - 60);
    expect(Number(maxAgeMatch?.[1])).toBeLessThanOrEqual(SESSION_MAX_AGE_S);
  });

  it("T1 — idle 61 minutes, still authenticated (61 min « 30 day expiry)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = new Date("2026-01-01T00:00:00.000Z");
    vi.setSystemTime(start);

    const user = await seedUser({
      name: "Idle User",
      email: `idle-${Date.now()}@example.com`,
      password: PASSWORD,
      role: "staff",
    });

    const auth = await getAuth();
    const signInResponse = (await auth.api.signInEmail({
      body: { email: user.email, password: PASSWORD },
      asResponse: true,
    })) as Response;
    const cookie = cookieHeaderFromResponse(signInResponse);

    vi.setSystemTime(new Date(start.getTime() + 61 * 60 * 1000));

    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    expect(session?.user).toBeDefined();
  });

  it("T3 — active use once a day for 3 simulated weeks never expires (rolling updateAge)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = new Date("2026-01-01T00:00:00.000Z");
    vi.setSystemTime(start);

    const user = await seedUser({
      name: "Daily User",
      email: `daily-${Date.now()}@example.com`,
      password: PASSWORD,
      role: "staff",
    });

    const auth = await getAuth();
    const signInResponse = (await auth.api.signInEmail({
      body: { email: user.email, password: PASSWORD },
      asResponse: true,
    })) as Response;
    let cookie = cookieHeaderFromResponse(signInResponse);

    for (let day = 1; day <= 21; day++) {
      vi.setSystemTime(new Date(start.getTime() + day * 24 * 60 * 60 * 1000 + 60_000));

      const response = (await auth.api.getSession({
        headers: new Headers({ cookie }),
        // disableCookieCache so each simulated day forces a fresh DB check
        // and roll, matching real daily-use behavior rather than serving
        // the 5-minute cookie cache.
        query: { disableCookieCache: true },
        asResponse: true,
      })) as Response;

      expect(response.status).toBeLessThan(400);
      const body = (await response.json()) as { user?: unknown } | null;
      expect(body?.user, `session should still be valid on day ${day}`).toBeDefined();

      const rolledCookie = cookieHeaderFromResponse(response);
      if (rolledCookie) cookie = rolledCookie;
    }
  });
});
