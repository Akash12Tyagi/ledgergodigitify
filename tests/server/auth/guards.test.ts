import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const headersState = vi.hoisted(() => ({ current: new Headers() as Headers }));

vi.mock("next/headers", () => ({
  headers: async () => headersState.current,
}));

// Imports after the mock so requireUser picks up the mocked next/headers.
const { requireUser } = await import("@/server/auth/guards");
const { seedUser, clearAllCollections } = await import("../../helpers/seed-user");
const { signInAndGetHeaders } = await import("../../helpers/auth-session");
const { UserModel } = await import("@/database/models/user.model");

describe("requireUser", () => {
  beforeEach(() => {
    headersState.current = new Headers();
  });

  afterEach(async () => {
    await clearAllCollections();
  });

  it("throws UNAUTHORIZED when there is no session", async () => {
    await expect(requireUser("viewer")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("resolves the authed user for a valid session with sufficient rank", async () => {
    const user = await seedUser({
      name: "Admin User",
      email: `admin-${Date.now()}@example.com`,
      password: "Correct-Horse-Battery-Staple-9",
      role: "admin",
    });
    headersState.current = await signInAndGetHeaders(
      user.email,
      "Correct-Horse-Battery-Staple-9"
    );

    const authed = await requireUser("staff");
    expect(authed.id).toBe(String(user._id));
    expect(authed.role).toBe("admin");
  });

  it("throws FORBIDDEN when role rank is insufficient (Section 1.2 matrix)", async () => {
    const user = await seedUser({
      name: "Staff User",
      email: `staff-${Date.now()}@example.com`,
      password: "Correct-Horse-Battery-Staple-9",
      role: "staff",
    });
    headersState.current = await signInAndGetHeaders(
      user.email,
      "Correct-Horse-Battery-Staple-9"
    );

    await expect(requireUser("owner")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("supports an explicit allow-list in place of a minimum rank", async () => {
    const user = await seedUser({
      name: "Viewer User",
      email: `viewer-${Date.now()}@example.com`,
      password: "Correct-Horse-Battery-Staple-9",
      role: "viewer",
    });
    headersState.current = await signInAndGetHeaders(
      user.email,
      "Correct-Horse-Battery-Staple-9"
    );

    await expect(requireUser(["viewer", "owner"])).resolves.toMatchObject({ role: "viewer" });
    await expect(requireUser(["admin", "owner"])).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("re-reads role fresh from the DB — a downgrade takes effect on the very next call (edge case 40)", async () => {
    const user = await seedUser({
      name: "Downgrade User",
      email: `downgrade-${Date.now()}@example.com`,
      password: "Correct-Horse-Battery-Staple-9",
      role: "owner",
    });
    headersState.current = await signInAndGetHeaders(
      user.email,
      "Correct-Horse-Battery-Staple-9"
    );

    await expect(requireUser("owner")).resolves.toMatchObject({ role: "owner" });

    // Role changes out-of-band (e.g. another admin demotes this user) —
    // the session cookie is untouched, only the DB role changes.
    await UserModel.findByIdAndUpdate(user._id, { $set: { role: "staff" } });

    await expect(requireUser("owner")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("throws UNAUTHORIZED for a deactivated user even with a live session", async () => {
    const user = await seedUser({
      name: "Deactivated User",
      email: `deactivated-${Date.now()}@example.com`,
      password: "Correct-Horse-Battery-Staple-9",
      role: "staff",
    });
    headersState.current = await signInAndGetHeaders(
      user.email,
      "Correct-Horse-Battery-Staple-9"
    );

    await UserModel.findByIdAndUpdate(user._id, { $set: { isActive: false } });

    await expect(requireUser("viewer")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
