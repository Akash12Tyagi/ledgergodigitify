import type { ReactNode } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// Section 7.4/7.1 — a static KPI figure (no drill-down navigation; see
// DrilldownCard for the clickable variant used on the dashboard/overview).
export function KpiCard({
  label,
  value,
  badge,
  tone,
  className,
}: {
  label: string;
  value: ReactNode;
  badge?: ReactNode;
  tone?: "neutral" | "warn";
  className?: string;
}) {
  return (
    <Card className={cn(tone === "warn" && "ring-warn/40", className)} size="sm">
      <CardHeader>
        <CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-2">
        <span className="text-xl font-semibold tabular-nums">{value}</span>
        {badge}
      </CardContent>
    </Card>
  );
}
