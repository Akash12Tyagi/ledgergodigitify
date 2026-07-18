import { afterEach, describe, expect, it } from "vitest";

import { getProfile, getProfileActivity, updateProfile } from "@/server/services/profile.service";
import { AuditLogModel } from "@/database/models/audit-log.model";
import { UserModel } from "@/database/models/user.model";
import { seedUser, clearAllCollections } from "../../helpers/seed-user";
import type { AuthedUser } from "@/server/auth/guards";

const PASSWORD = "Correct-Horse-Battery-Staple-9";

function actorFrom(user: { _id: unknown; name: string; email: string; role: string }): AuthedUser {
  return { id: String(user._id), name: user.name, email: user.email, role: user.role as AuthedUser["role"] };
}

afterEach(async () => {
  await clearAllCollections();
});

describe("profile.service — getProfile (Section 7)", () => {
  it("returns the caller's own record, mapped to ProfileData", async () => {
    const user = await seedUser({ name: "Jane Staff", email: `prof1-${Date.now()}@example.com`, password: PASSWORD, role: "staff" });

    const profile = await getProfile(String(user._id));

    expect(profile.name).toBe("Jane Staff");
    expect(profile.role).toBe("staff");
    expect(profile.isActive).toBe(true);
    expect(profile.phone).toBeNull();
    expect(profile.image).toBeNull();
    expect(profile.lastLoginAt).toBeNull();
  });

  it("rejects an unknown user id", async () => {
    await expect(getProfile("64b64b64b64b64b64b64b64b")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("profile.service — updateProfile (Section 7)", () => {
  it("updates name/phone/image, persists them, and audits the change", async () => {
    const user = await seedUser({ name: "Old Name", email: `prof2-${Date.now()}@example.com`, password: PASSWORD, role: "staff" });
    const actor = actorFrom(user);

    const updated = await updateProfile(
      { name: "New Name", phone: "+91 98765 43210", image: "https://example.com/avatar.png" },
      actor
    );

    expect(updated.name).toBe("New Name");
    expect(updated.phone).toBe("+91 98765 43210");
    expect(updated.image).toBe("https://example.com/avatar.png");

    const persisted = await UserModel.findById(user._id).lean();
    expect(persisted?.name).toBe("New Name");
    expect(persisted?.phone).toBe("+91 98765 43210");

    const audit = await AuditLogModel.findOne({ action: "PROFILE_UPDATED" }).lean();
    expect(audit).not.toBeNull();
    expect(String(audit?.entity?.id)).toBe(String(user._id));
  });

  it("clears phone/image when given null, and never touches role/email/isActive", async () => {
    const user = await seedUser({ name: "Has Phone", email: `prof3-${Date.now()}@example.com`, password: PASSWORD, role: "admin" });
    const actor = actorFrom(user);
    await updateProfile({ name: "Has Phone", phone: "123", image: null }, actor);

    const updated = await updateProfile({ name: "Has Phone", phone: null, image: null }, actor);
    expect(updated.phone).toBeNull();
    expect(updated.image).toBeNull();
    expect(updated.role).toBe("admin");
    expect(updated.email).toBe(user.email);
  });
});

describe("profile.service — getProfileActivity (Section 7)", () => {
  it("returns the caller's own LOGIN/PROFILE_UPDATED trail, newest first", async () => {
    const user = await seedUser({ name: "Active User", email: `prof4-${Date.now()}@example.com`, password: PASSWORD, role: "staff" });
    const actor = actorFrom(user);

    await updateProfile({ name: "Active User v2", phone: null, image: null }, actor);
    const rows = await getProfileActivity(String(user._id));

    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.action).toBe("PROFILE_UPDATED");
    expect(rows[0]?.summary).toContain("updated their profile");
  });

  it("never returns another user's activity", async () => {
    const userA = await seedUser({ name: "User A", email: `prof5-${Date.now()}@example.com`, password: PASSWORD, role: "staff" });
    const userB = await seedUser({ name: "User B", email: `prof6-${Date.now()}@example.com`, password: PASSWORD, role: "staff" });
    await updateProfile({ name: "User A renamed", phone: null, image: null }, actorFrom(userA));

    const rowsForB = await getProfileActivity(String(userB._id));
    expect(rowsForB).toHaveLength(0);
  });
});
