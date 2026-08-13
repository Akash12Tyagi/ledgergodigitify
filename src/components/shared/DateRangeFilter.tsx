"use client";

import * as React from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { CalendarRangeIcon, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ALL_TIME_LABEL,
  DATE_FROM_PARAM,
  DATE_PRESETS,
  DATE_TO_PARAM,
  describeDateWindow,
  toISODateIST,
} from "@/lib/date-range";

/**
 * Exact From–To dates for a list view, written to the query string.
 *
 * Separate from PeriodRangePicker on purpose: that one drives the app-wide
 * month period behind every aggregate figure, and lives in a cookie so the
 * Dashboard and Overview can never disagree. This one narrows a single list
 * to real days, stays in the URL so it can be shared, and does not leak into
 * other screens.
 *
 * With no dates set the list shows everything — "All time" is both the
 * default and an explicit choice in the panel, so getting back to the whole
 * record set is one click rather than a guess at which months to pick.
 */
export function DateRangeFilter({
  from,
  to,
}: {
  from: string | null;
  to: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  const [draftFrom, setDraftFrom] = React.useState(from ?? "");
  const [draftTo, setDraftTo] = React.useState(to ?? "");

  /** Seeded when the popover opens rather than synced from props in an
   * effect: the draft only ever needs to match the applied range at the
   * moment the panel is shown, and doing it here avoids a state write
   * during render that would cascade. */
  function handleOpenChange(next: boolean) {
    if (next) {
      setDraftFrom(from ?? "");
      setDraftTo(to ?? "");
    }
    setOpen(next);
  }

  const today = toISODateIST(new Date());
  const isFiltered = Boolean(from || to);

  function apply(nextFrom: string, nextTo: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (nextFrom) params.set(DATE_FROM_PARAM, nextFrom);
    else params.delete(DATE_FROM_PARAM);
    if (nextTo) params.set(DATE_TO_PARAM, nextTo);
    else params.delete(DATE_TO_PARAM);
    // A narrowed range almost never has the same page count as the old one.
    params.set("page", "1");
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
      setOpen(false);
    });
  }

  const label = describeDateWindow(from, to);

  return (
    <div className="flex items-center gap-1">
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger
          render={<Button variant="outline" size="sm" disabled={pending} className="gap-1.5" />}
        >
          <CalendarRangeIcon className="size-3.5" />
          <span className="tabular-nums">{label}</span>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80">
          <div className="grid gap-3">
            {/* Full width and first, ahead of the narrowing presets: it is
                the default state, and the one people reach for when a row
                they just recorded is not where they expected it. */}
            <Button
              variant={isFiltered ? "ghost" : "secondary"}
              size="sm"
              className="w-full"
              onClick={() => apply("", "")}
            >
              {ALL_TIME_LABEL}
            </Button>

            <div className="grid grid-cols-2 gap-1.5 border-t pt-3">
              {DATE_PRESETS.map((preset) => (
                <Button
                  key={preset.id}
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const range = preset.range();
                    apply(range.from, range.to);
                  }}
                >
                  {preset.label}
                </Button>
              ))}
            </div>

            <div className="border-t pt-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-1">
                  <Label htmlFor="date-range-from" className="text-xs text-muted-foreground">
                    From
                  </Label>
                  <Input
                    id="date-range-from"
                    type="date"
                    max={draftTo || today}
                    value={draftFrom}
                    onChange={(e) => setDraftFrom(e.target.value)}
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="date-range-to" className="text-xs text-muted-foreground">
                    To
                  </Label>
                  <Input
                    id="date-range-to"
                    type="date"
                    min={draftFrom || undefined}
                    max={today}
                    value={draftTo}
                    onChange={(e) => setDraftTo(e.target.value)}
                  />
                </div>
              </div>
              <Button
                className="mt-2 w-full"
                size="sm"
                disabled={!draftFrom || !draftTo || pending}
                onClick={() => apply(draftFrom, draftTo)}
              >
                Apply
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {isFiltered ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Clear date filter — show all time"
          disabled={pending}
          onClick={() => apply("", "")}
        >
          <X className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}
