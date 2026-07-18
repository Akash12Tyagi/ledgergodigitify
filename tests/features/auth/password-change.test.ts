import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const headersState = vi.hoisted(() => ({ current: new Headers() as Headers }));

vi.mock("next/headers", () => ({
  headers: async () => headersState.current,
}));

const { getAuth } = await import("@/server/auth/auth");
const { changePasswordAction } = await import("@/features/auth/actions");
const { seedUser, clearAllCollections } = await import("../../helpers/seed-user");
const { cookieHeaderFromResponse } = await import("../../helpers/auth-session");

const PASSWORD = "Correct-Horse-Battery-Staple-9";
const NEW_PASSWORD = "Battery-Staple-Correct-Horse-7";

describe("Section 11 T4 — password change revokes other sessions", () => {
  beforeEach(() => {
    headersState.current = new Headers();
  });

  afterEach(async () => {
    await clearAllCollections();
  });

  it("device B's session stops working after device A changes the password", async () => {
    const user = await seedUser({
      name: "Two Device User",
      email: `twodevice-${Date.now()}@example.com`,
      password: PASSWORD,
      role: "staff",
    });

    const auth = await getAuth();

    const deviceAResponse = (await auth.api.signInEmail({
      body: { email: user.email, password: PASSWORD },
      asResponse: true,
    })) as Response;
    const deviceACookie = cookieHeaderFromResponse(deviceAResponse);

    const deviceBResponse = (await auth.api.signInEmail({
      body: { email: user.email, password: PASSWORD },
      asResponse: true,
    })) as Response;
    const deviceBCookie = cookieHeaderFromResponse(deviceBResponse);

    // Sanity check: both sessions work before the password change.
    const beforeB = await auth.api.getSession({ headers: new Headers({ cookie: deviceBCookie }) });
    expect(beforeB?.user).toBeDefined();

    headersState.current = new Headers({ cookie: deviceACookie });
    const result = await changePasswordAction({
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    expect(result.success).toBe(true);

    const afterB = await auth.api.getSession({
      headers: new Headers({ cookie: deviceBCookie }),
      query: { disableCookieCache: true },
    });
    expect(afterB).toBeNull();
  });
});
