import { Settings2 } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import type { Theme } from "@/lib/theme";

function PreferenceRow({
  label,
  description,
  control,
}: {
  label: string;
  description: string;
  control: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="grid gap-0.5">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {control}
    </div>
  );
}

// Section 7 Profile page — "Preferences". Only Theme is a real, saved
// setting (cookie-backed, Section 12); Timezone and Currency are fixed
// app-wide (Section 2.9 IST, Section 2.7 paise/INR) so they're shown
// read-only rather than as controls that would do nothing.
export function PreferencesCard({ theme }: { theme: Theme }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 text-sm font-medium">
          <Settings2 className="size-4" />
          Preferences
        </CardTitle>
        <CardDescription>Display and locale preferences.</CardDescription>
      </CardHeader>
      <CardContent className="divide-y">
        <PreferenceRow
          label="Theme"
          description={theme === "dark" ? "Dark" : "Light"}
          control={<ThemeToggle theme={theme} />}
        />
        <PreferenceRow
          label="Timezone"
          description="Fixed for all users — every date and due date is calculated in IST."
          control={<span className="text-sm text-muted-foreground">Asia/Kolkata (IST)</span>}
        />
        <PreferenceRow
          label="Currency"
          description="Fixed — all amounts are recorded and displayed in Indian Rupees."
          control={<span className="text-sm text-muted-foreground">INR (₹)</span>}
        />
      </CardContent>
    </Card>
  );
}
