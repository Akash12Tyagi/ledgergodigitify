import { Activity, MonitorSmartphone } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/EmptyState";
import type { ProfileActivityRow } from "@/server/services/profile.service";

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Section 7 Profile page — "Activity": recent sign-in/account activity,
// with IP + user agent standing in for "device/session information" (there
// is no separate active-session listing in scope — see profile.service.ts).
export function ActivityCard({ rows }: { rows: ProfileActivityRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 text-sm font-medium">
          <Activity className="size-4" />
          Activity
        </CardTitle>
        <CardDescription>Recent sign-in and account activity.</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState title="No activity yet" />
        ) : (
          <div className="grid gap-1">
            {rows.map((row) => (
              <div key={row.id} className="grid gap-0.5 rounded-lg px-2 py-1.5 text-sm hover:bg-muted/40">
                <div className="flex items-center justify-between gap-2">
                  <span>{row.summary}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {formatTimestamp(row.createdAt)}
                  </span>
                </div>
                {row.ip || row.userAgent ? (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <MonitorSmartphone className="size-3 shrink-0" />
                    <span className="truncate">{[row.ip, row.userAgent].filter(Boolean).join(" · ")}</span>
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
