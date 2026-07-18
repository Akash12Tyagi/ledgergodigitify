import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Section 4.6 — every aggregate card is produced with a TxFilter, and its
 * `href` points at the sibling list built from the SAME filter (serialized
 * in the query string), so card === Σ(rows) by construction. This
 * component only renders the card + navigation; the dev-mode
 * cardValue===sum(rows) assertion belongs to the list view that opens
 * when `href` is followed (Section 4.6: "asserts... when the list is
 * opened"), which lands with the overview/dashboard pages in M5.
 */
export function DrilldownCard({
  label,
  value,
  href,
  ariaLabel,
  tone,
  className,
}: {
  label: string;
  value: string;
  href: string;
  /** e.g. "View the 3 entries totalling ₹12,000" (Section 12). */
  ariaLabel: string;
  tone?: "neutral" | "warn" | "danger";
  className?: string;
}) {
  return (
    <Link href={href} aria-label={ariaLabel} className="group block">
      <Card
        className={cn(
          "transition-colors group-hover:ring-2 group-hover:ring-ring/50",
          tone === "warn" && "ring-1 ring-warn/40",
          tone === "danger" && "ring-1 ring-money-out/40",
          className
        )}
        size="sm"
      >
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-xs font-medium text-muted-foreground">
            {label}
            <ChevronRight className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <span
            className={cn(
              "text-xl font-semibold tabular-nums",
              tone === "danger" && "text-money-out"
            )}
          >
            {value}
          </span>
        </CardContent>
      </Card>
    </Link>
  );
}
