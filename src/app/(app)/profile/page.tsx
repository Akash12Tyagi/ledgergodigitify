import type { Metadata } from "next";
import { cookies } from "next/headers";

import { PageHeader } from "@/components/shared/PageHeader";
import { ChangePasswordCard } from "@/components/shared/ChangePasswordCard";
import { ProfileHeader } from "@/features/profile/components/ProfileHeader";
import { AccountSettingsForm } from "@/features/profile/components/AccountSettingsForm";
import { PreferencesCard } from "@/features/profile/components/PreferencesCard";
import { ActivityCard } from "@/features/profile/components/ActivityCard";
import { getProfile, getProfileActivity } from "@/server/services/profile.service";
import { requireAuthenticated } from "@/server/auth/guards";
import { isTheme, THEME_COOKIE } from "@/lib/theme";

export const metadata: Metadata = { title: "Profile — Finance & Ledger" };
export const dynamic = "force-dynamic";

// Section 7 — /profile. Every signed-in role may view/edit their own
// profile (Section 1.2 "view everything" baseline); role/email/status stay
// read-only here and owner-controlled via /settings/users.
export default async function ProfilePage() {
  const actor = await requireAuthenticated();
  const cookieStore = await cookies();
  const cookieTheme = cookieStore.get(THEME_COOKIE)?.value;
  const theme = isTheme(cookieTheme) ? cookieTheme : "light";

  const [profile, activity] = await Promise.all([getProfile(actor.id), getProfileActivity(actor.id)]);

  return (
    <div className="grid gap-6">
      <PageHeader title="Profile" description="Manage your account, security, and preferences." />
      <ProfileHeader profile={profile} />
      <div className="grid gap-6 lg:grid-cols-2">
        <AccountSettingsForm profile={profile} />
        <ChangePasswordCard />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <PreferencesCard theme={theme} />
        <ActivityCard rows={activity} />
      </div>
    </div>
  );
}
