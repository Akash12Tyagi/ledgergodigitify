"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarRangeIcon, ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { setPeriodRangeAction } from "@/components/shared/period-range-actions";
import { usePeriodRangeStore } from "@/components/shared/period-range-store";
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

/** One Month + Year select pair, reused for both the "From" and "To"
 * bounds below — the only difference between them is which side of the
 * range they're allowed to touch (`boundMin`/`boundMax`). */
function MonthYearFields({
  label,
  value,
  boundMin,
  boundMax,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  boundMin: string;
  boundMax: string;
  disabled: boolean;
  onChange: (next: string) => void;
}) {
  const { year, month } = parseMonthKey(value);
  const { year: minYear, month: minMonth } = parseMonthKey(boundMin);
  const { year: maxYear } = parseMonthKey(boundMax);
  const years = range(Math.min(minYear, year), Math.max(maxYear, year));

  function handleMonthChange(monthStr: string | null) {
    if (!monthStr) return;
    onChange(buildMonthKey(year, Number(monthStr)));
  }

  function handleYearChange(yearStr: string | null) {
    if (!yearStr) return;
    const nextYear = Number(yearStr);
    let nextMonth = month;
    if (nextYear === minYear && nextMonth < minMonth) nextMonth = minMonth;
    onChange(buildMonthKey(nextYear, nextMonth));
  }

  return (
    <div className="grid gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="grid grid-cols-2 gap-2">
        <Select value={String(month)} onValueChange={handleMonthChange} disabled={disabled}>
          <SelectTrigger className="w-full" aria-label={`Select ${label.toLowerCase()} month`}>
            <SelectValue>{(value: string) => MONTH_NAMES[Number(value) - 1]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {MONTH_NAMES.map((name, i) => {
              const candidate = buildMonthKey(year, i + 1);
              const optionDisabled = candidate < boundMin || candidate > boundMax;
              return (
                <SelectItem key={name} value={String(i + 1)} disabled={optionDisabled}>
                  {name}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        <Select value={String(year)} onValueChange={handleYearChange} disabled={disabled}>
          <SelectTrigger className="w-full" aria-label={`Select ${label.toLowerCase()} year`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {years.map((y) => (
              <SelectItem key={y} value={String(y)}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

/**
 * The app-wide From–To period picker: two Month/Year fields plus preset
 * shortcuts, driving every period-scoped figure in the app — the Dashboard,
 * the Ledger Overview's money-math block and transaction list, and the
 * Billed drill-down. All of them read the one cookie pair this writes
 * (lib/period-range-context.ts), so the screens can never disagree about
 * which period is being viewed.
 *
 * It replaced MonthPicker, which browsed a single month through a separate
 * cookie: the Ledger and the Dashboard each tracked their own idea of "now"
 * and routinely showed different periods side by side.
 *
 * `minMonthKey` (optional — the configured go-live date) floors `from`;
 * unset means no lower bound at all. `to` is always capped at the real
 * current month so future periods are never selectable.
 */
export function PeriodRangePicker({
  fromMonthKey,
  toMonthKey: toMonthKeyProp,
  minMonthKey,
}: {
  fromMonthKey: string;
  toMonthKey: string;
  minMonthKey?: string | undefined;
}) {
  const router = useRouter();
  const { from: storeFrom, to: storeTo, setRange } = usePeriodRangeStore();
  const [pending, startTransition] = React.useTransition();
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    setRange(fromMonthKey, toMonthKeyProp);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync store from the SSR values only
  }, [fromMonthKey, toMonthKeyProp]);

  const from = storeFrom || fromMonthKey;
  const to = storeTo || toMonthKeyProp;
  const currentRealMonth = toMonthKey(nowIST());
  const floor = minMonthKey ?? "0001-01";

  function navigate(nextFrom: string, nextTo: string) {
    const clampedTo = nextTo > currentRealMonth ? currentRealMonth : nextTo;
    const clampedFrom = nextFrom < floor ? floor : nextFrom;
    const safeFrom = clampedFrom > clampedTo ? clampedTo : clampedFrom;
    setRange(safeFrom, clampedTo);
    startTransition(async () => {
      await setPeriodRangeAction(safeFrom, clampedTo);
      router.refresh();
    });
  }

  function shiftWindow(delta: number) {
    navigate(shiftMonthKey(from, delta), shiftMonthKey(to, delta));
  }

  const canGoPrev = !minMonthKey || shiftMonthKey(from, -1) >= minMonthKey;
  const canGoNext = shiftMonthKey(to, 1) <= currentRealMonth;
  const isSingleMonth = from === to;
  const isCurrentMonthOnly = isSingleMonth && to === currentRealMonth;

  const label = isSingleMonth
    ? formatMonthLabel(to)
    : `${formatMonthLabel(from)} – ${formatMonthLabel(to)}`;

  function applyPreset(nextFrom: string, nextTo: string) {
    navigate(nextFrom, nextTo);
    setOpen(false);
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="outline"
        size="icon-sm"
        onClick={() => shiftWindow(-1)}
        disabled={pending || !canGoPrev}
        aria-label="Previous period"
      >
        <ChevronLeft className="size-4" />
      </Button>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={<Button variant="outline" size="sm" disabled={pending} className="min-w-40 gap-1.5" />}
        >
          <CalendarRangeIcon className="size-3.5" />
          <span className="tabular-nums">{label}</span>
        </PopoverTrigger>
        <PopoverContent align="center" className="w-80">
          <div className="grid gap-3">
            <MonthYearFields
              label="From"
              value={from}
              boundMin={floor}
              boundMax={to}
              disabled={pending}
              onChange={(next) => navigate(next, to)}
            />
            <MonthYearFields
              label="To"
              value={to}
              boundMin={from}
              boundMax={currentRealMonth}
              disabled={pending}
              onChange={(next) => navigate(from, next)}
            />
            <div className="grid grid-cols-2 gap-1.5 pt-1">
              <Button variant="ghost" size="sm" onClick={() => applyPreset(currentRealMonth, currentRealMonth)}>
                This Month
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => applyPreset(shiftMonthKey(currentRealMonth, -2), currentRealMonth)}
              >
                Last 3 Months
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => applyPreset(shiftMonthKey(currentRealMonth, -5), currentRealMonth)}
              >
                Last 6 Months
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => applyPreset(buildMonthKey(parseMonthKey(currentRealMonth).year, 1), currentRealMonth)}
              >
                Year to Date
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      <Button
        variant="outline"
        size="icon-sm"
        onClick={() => shiftWindow(1)}
        disabled={pending || !canGoNext}
        aria-label="Next period"
      >
        <ChevronRight className="size-4" />
      </Button>

      {!isCurrentMonthOnly ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(currentRealMonth, currentRealMonth)}
          disabled={pending}
        >
          Today
        </Button>
      ) : null}
    </div>
  );
}
