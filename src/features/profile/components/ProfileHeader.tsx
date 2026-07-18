import { CalendarClock, Mail } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge, type DisplayStatus } from "@/components/shared/StatusBadge";
import { initials } from "@/lib/utils";
import type { ProfileData } from "@/server/services/profile.service";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// Section 7 Profile page — "User Information": name, email, role, status,
// avatar (initials fallback), account-created date, last login.
export function ProfileHeader({ profile }: { profile: ProfileData }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Avatar className="size-16">
            {profile.image ? <AvatarImage src={profile.image} alt={profile.name} /> : null}
            <AvatarFallback className="text-lg">{initials(profile.name)}</AvatarFallback>
          </Avatar>
          <div className="grid gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold leading-tight">{profile.name}</h2>
              <Badge variant="outline" className="capitalize">
                {profile.role}
              </Badge>
              <StatusBadge status={(profile.isActive ? "ACTIVE" : "ARCHIVED") as DisplayStatus} />
            </div>
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Mail className="size-3.5" />
              {profile.email}
            </p>
          </div>
        </div>
        <div className="grid gap-1 text-sm text-muted-foreground sm:text-right">
          <p className="flex items-center gap-1.5 sm:justify-end">
            <CalendarClock className="size-3.5" />
            Member since {formatDate(profile.createdAt)}
          </p>
          <p>Last login: {profile.lastLoginAt ? formatDate(profile.lastLoginAt) : "Never"}</p>
        </div>
      </CardContent>
    </Card>
  );
}
