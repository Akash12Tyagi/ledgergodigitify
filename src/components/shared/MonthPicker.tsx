"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { setMonthAction } from "@/components/shared/month-actions";
import { useMonthStore } from "@/components/shared/month-store";
import { formatMonthLabel, nowIST, shiftMonthKey, toMonthKey } from "@/lib/dates";

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parseMonthKey(monthKey: string): { year: number; month: number } {
  const [yearStr, monthStr] = monthKey.split("-");
  return { year: Number(yearStr), month: Number(monthStr) };
}

function buildMonthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * Section 7.1/7.5 — the active-month picker shared by /dashboard and
 * /ledger/overview. `monthKey` is the SSR-resolved value (from the cookie,
 * lib/month-context.ts); navigating here updates the cookie via
 * setMonthAction and calls router.refresh() so the RSC re-fetches with the
 * new month (Law 1 — no client-side money math, just a new server call).
 *
 * `minMonthKey` (optional — the company's go-live month) floors how far
 * back the calendar and chevrons can go; the real current month always
 * caps the top end, so future months are never selectable.
 */
export function MonthPicker({
  monthKey,
  minMonthKey,
}: {
  monthKey: string;
  minMonthKey?: string | undefined;
}) {
  const router = useRouter();
  const { monthKey: storeMonthKey, setMonthKey } = useMonthStore();
  const [pending, startTransition] = React.useTransition();
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    setMonthKey(monthKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync store from the SSR value only
  }, [monthKey]);

  const current = storeMonthKey || monthKey;
  const currentRealMonth = toMonthKey(nowIST());
  const [viewYear, setViewYear] = React.useState(() => parseMonthKey(current).year);

  function handleOpenChange(next: boolean) {
    if (next) setViewYear(parseMonthKey(current).year);
    setOpen(next);
  }

  function navigate(next: string) {
    if (next > currentRealMonth) return;
    if (minMonthKey && next < minMonthKey) return;
    setMonthKey(next);
    startTransition(async () => {
      await setMonthAction(next);
      router.refresh();
    });
  }

  const canGoPrev = !minMonthKey || shiftMonthKey(current, -1) >= minMonthKey;
  const canGoNext = shiftMonthKey(current, 1) <= currentRealMonth;
  const minYear = minMonthKey ? parseMonthKey(minMonthKey).year : undefined;
  const maxYear = parseMonthKey(currentRealMonth).year;

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="outline"
        size="icon-sm"
        onClick={() => navigate(shiftMonthKey(current, -1))}
        disabled={pending || !canGoPrev}
        aria-label="Previous month"
      >
        <ChevronLeft className="size-4" />
      </Button>

      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger
          render={<Button variant="outline" size="sm" disabled={pending} className="min-w-32 gap-1.5" />}
        >
          <CalendarIcon className="size-3.5" />
          <span className="tabular-nums">{formatMonthLabel(current)}</span>
        </PopoverTrigger>
        <PopoverContent align="center">
          <div className="mb-2 flex items-center justify-between">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setViewYear((y) => y - 1)}
              disabled={minYear !== undefined && viewYear <= minYear}
              aria-label="Previous year"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="text-sm font-medium tabular-nums">{viewYear}</span>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setViewYear((y) => y + 1)}
              disabled={viewYear >= maxYear}
              aria-label="Next year"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {MONTH_ABBR.map((label, i) => {
              const month = i + 1;
              const candidate = buildMonthKey(viewYear, month);
              const disabled = candidate > currentRealMonth || (minMonthKey ? candidate < minMonthKey : false);
              const selected = candidate === current;
              return (
                <Button
                  key={label}
                  type="button"
                  variant={selected ? "default" : "ghost"}
                  size="sm"
                  disabled={disabled}
                  onClick={() => {
                    navigate(candidate);
                    setOpen(false);
                  }}
                  className={cn("justify-center", selected && "pointer-events-none")}
                >
                  {label}
                </Button>
              );
            })}
          </div>
          {current !== currentRealMonth ? (
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 w-full"
              onClick={() => {
                navigate(currentRealMonth);
                setOpen(false);
              }}
            >
              Current Month
            </Button>
          ) : null}
        </PopoverContent>
      </Popover>

      <Button
        variant="outline"
        size="icon-sm"
        onClick={() => navigate(shiftMonthKey(current, 1))}
        disabled={pending || !canGoNext}
        aria-label="Next month"
      >
        <ChevronRight className="size-4" />
      </Button>

      {current !== currentRealMonth ? (
        <Button variant="ghost" size="sm" onClick={() => navigate(currentRealMonth)} disabled={pending}>
          Today
        </Button>
      ) : null}
    </div>
  );
}
