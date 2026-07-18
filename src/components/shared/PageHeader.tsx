import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// Section 12 — page title 24/600. Section 7.2 pattern: header + optional
// primary action top-left of content area, optional right-side controls.
export function PageHeader({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4 pb-6", className)}>
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold leading-tight">{title}</h1>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
