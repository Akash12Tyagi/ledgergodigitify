"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { setMonthAction } from "@/components/shared/month-actions";
import { useMonthStore } from "@/components/shared/month-store";
import { formatMonthLabel, nowIST, shiftMonthKey, toMonthKey } from "@/lib/dates";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function parseMonthKey(monthKey: string): { year: number; month: number } {
  const [yearStr, monthStr] = monthKey.split("-");
  return { year: Number(yearStr), month: Number(monthStr) };
}

function buildMonthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function range(start: number, end: number): number[] {
  const out: number[] = [];
  for (let n = start; n <= end; n++) out.push(n);
  return out;
}

/**
 * Section 7.1/7.5 — the active-month picker shared by /dashboard and
 * /ledger/overview. `monthKey` is the SSR-resolved value (from the cookie,
 * lib/month-context.ts); navigating here updates the cookie via
 * setMonthAction and calls router.refresh() so the RSC re-fetches with the
 * new month (Law 1 — no client-side money math, just a new server call).
 *
 * `minMonthKey` (optional — the company's go-live month, falling back to
 * its first financial record) floors how far back the picker can go; the
 * real current month always caps the top end, so future months are never
 * selectable.
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
  const { year: currentYear, month: currentMonth } = parseMonthKey(current);
  const { year: maxYear, month: maxMonth } = parseMonthKey(currentRealMonth);
  const minYear = minMonthKey ? parseMonthKey(minMonthKey).year : maxYear;

  function navigate(next: string) {
    if (next > currentRealMonth) return;
    if (minMonthKey && next < minMonthKey) return;
    setMonthKey(next);
    startTransition(async () => {
      await setMonthAction(next);
      router.refresh();
    });
  }

  function handleYearChange(yearStr: string | null) {
    if (!yearStr) return;
    const year = Number(yearStr);
    // Clamp the month when the newly picked year would otherwise put the
    // current month out of range (e.g. jumping to the current year while
    // sitting on a month later than "now").
    let month = currentMonth;
    if (year === maxYear && month > maxMonth) month = maxMonth;
    if (minMonthKey) {
      const min = parseMonthKey(minMonthKey);
      if (year === min.year && month < min.month) month = min.month;
    }
    navigate(buildMonthKey(year, month));
  }

  function handleMonthChange(monthStr: string | null) {
    if (!monthStr) return;
    navigate(buildMonthKey(currentYear, Number(monthStr)));
  }

  const canGoPrev = !minMonthKey || shiftMonthKey(current, -1) >= minMonthKey;
  const canGoNext = shiftMonthKey(current, 1) <= currentRealMonth;
  // Guards against a misconfigured minMonthKey (e.g. a go-live date in the
  // future) ever excluding the currently-selected year from its own Select.
  const years = range(Math.min(minYear, currentYear), Math.max(maxYear, currentYear));

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

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={<Button variant="outline" size="sm" disabled={pending} className="min-w-32 gap-1.5" />}
        >
          <CalendarIcon className="size-3.5" />
          <span className="tabular-nums">{formatMonthLabel(current)}</span>
        </PopoverTrigger>
        <PopoverContent align="center" className="w-64">
          <div className="grid grid-cols-2 gap-2">
            <Select value={String(currentMonth)} onValueChange={handleMonthChange} disabled={pending}>
              <SelectTrigger className="w-full" aria-label="Select month">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTH_NAMES.map((name, i) => {
                  const month = i + 1;
                  const candidate = buildMonthKey(currentYear, month);
                  const disabled = candidate > currentRealMonth || (minMonthKey ? candidate < minMonthKey : false);
                  return (
                    <SelectItem key={name} value={String(month)} disabled={disabled}>
                      {name}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <Select value={String(currentYear)} onValueChange={handleYearChange} disabled={pending}>
              <SelectTrigger className="w-full" aria-label="Select year">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map((year) => (
                  <SelectItem key={year} value={String(year)}>
                    {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
