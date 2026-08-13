"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarRangeIcon, ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  setPeriodAllTimeAction,
  setPeriodRangeAction,
} from "@/components/shared/period-range-actions";
import { usePeriodRangeStore } from "@/components/shared/period-range-store";
import { cn } from "@/lib/utils";
import { ALL_TIME_LABEL } from "@/lib/period-range-context";
import { formatMonthLabel, nowIST, shiftMonthKey, toMonthKey } from "@/lib/dates";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** The three ways a period can be expressed, in the order the panel offers
 * them: the whole record first, one month next, an arbitrary span last. */
type Mode = "all" | "month" | "custom";

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

/** One Month + Year select pair, reused for the single-month field and for
 * both bounds of a custom span — the only difference between them is which
 * side of the range they're allowed to touch (`boundMin`/`boundMax`). */
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
 * The app-wide period picker: All time, one month, or a custom From–To span,
 * driving every period-scoped figure in the app — the Dashboard, the Ledger
 * Overview's money-math block and transaction list, and the Billed
 * drill-down. All of them read the one cookie pair this writes
 * (lib/period-range-context.ts), so the screens can never disagree about
 * which period is being viewed.
 *
 * All time is the default and the first thing the panel offers. A ledger's
 * first useful question is "what is the whole picture"; opening on the
 * current month meant a freshly-loaded app looked empty on the 1st, and hid
 * every figure entered against an earlier month behind a control the user
 * had to discover first.
 *
 * `minMonthKey` (optional — the configured go-live date) floors `from`;
 * unset means no lower bound at all. `to` is always capped at the real
 * current month so future periods are never selectable.
 */
export function PeriodRangePicker({
  fromMonthKey,
  toMonthKey: toMonthKeyProp,
  isAllTime: isAllTimeProp,
  minMonthKey,
}: {
  fromMonthKey: string;
  toMonthKey: string;
  isAllTime: boolean;
  minMonthKey?: string | undefined;
}) {
  const router = useRouter();
  const { period: storePeriod, setPeriod } = usePeriodRangeStore();
  const [pending, startTransition] = React.useTransition();
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    setPeriod({ from: fromMonthKey, to: toMonthKeyProp, isAllTime: isAllTimeProp });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync store from the SSR values only
  }, [fromMonthKey, toMonthKeyProp, isAllTimeProp]);

  const period = storePeriod ?? { from: fromMonthKey, to: toMonthKeyProp, isAllTime: isAllTimeProp };
  const currentRealMonth = toMonthKey(nowIST());
  const floor = minMonthKey ?? "0001-01";

  // All time has no editable bounds — its `from` is the "0000-01" query
  // floor, which must never reach a Month/Year field. The panel edits the
  // current month instead, so switching to Month or Custom starts somewhere
  // real rather than in year zero.
  const from = period.isAllTime ? currentRealMonth : period.from;
  const to = period.isAllTime ? currentRealMonth : period.to;
  const mode: Mode = period.isAllTime ? "all" : from === to ? "month" : "custom";

  function navigate(nextFrom: string, nextTo: string) {
    const clampedTo = nextTo > currentRealMonth ? currentRealMonth : nextTo;
    const clampedFrom = nextFrom < floor ? floor : nextFrom;
    const safeFrom = clampedFrom > clampedTo ? clampedTo : clampedFrom;
    setPeriod({ from: safeFrom, to: clampedTo, isAllTime: false });
    startTransition(async () => {
      await setPeriodRangeAction(safeFrom, clampedTo);
      router.refresh();
    });
  }

  function selectAllTime() {
    setPeriod({ from, to: currentRealMonth, isAllTime: true });
    startTransition(async () => {
      await setPeriodAllTimeAction();
      router.refresh();
    });
    setOpen(false);
  }

  function shiftWindow(delta: number) {
    navigate(shiftMonthKey(from, delta), shiftMonthKey(to, delta));
  }

  const canGoPrev = !period.isAllTime && (!minMonthKey || shiftMonthKey(from, -1) >= minMonthKey);
  const canGoNext = !period.isAllTime && shiftMonthKey(to, 1) <= currentRealMonth;

  const label = period.isAllTime
    ? ALL_TIME_LABEL
    : from === to
      ? formatMonthLabel(to)
      : `${formatMonthLabel(from)} – ${formatMonthLabel(to)}`;

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
            <div
              role="radiogroup"
              aria-label="Period type"
              className="grid grid-cols-3 gap-1 rounded-md bg-muted p-1"
            >
              <ModeTab
                label={ALL_TIME_LABEL}
                active={mode === "all"}
                disabled={pending}
                onSelect={selectAllTime}
              />
              <ModeTab
                label="Month"
                active={mode === "month"}
                disabled={pending}
                onSelect={() => navigate(to, to)}
              />
              <ModeTab
                label="Custom"
                active={mode === "custom"}
                disabled={pending}
                // A custom span has to start as an actual span, or the panel
                // would switch to "Custom" and immediately read back as
                // "Month" because from still equals to.
                onSelect={() => navigate(shiftMonthKey(to, -2), to)}
              />
            </div>

            {mode === "all" ? (
              <p className="text-xs text-muted-foreground">
                Every figure on this screen covers the whole record, from the first entry to today.
              </p>
            ) : mode === "month" ? (
              <MonthYearFields
                label="Month"
                value={to}
                boundMin={floor}
                boundMax={currentRealMonth}
                disabled={pending}
                onChange={(next) => navigate(next, next)}
              />
            ) : (
              <>
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
                <div className="grid grid-cols-3 gap-1.5 pt-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate(shiftMonthKey(currentRealMonth, -2), currentRealMonth)}
                  >
                    3 Months
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate(shiftMonthKey(currentRealMonth, -5), currentRealMonth)}
                  >
                    6 Months
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      navigate(buildMonthKey(parseMonthKey(currentRealMonth).year, 1), currentRealMonth)
                    }
                  >
                    YTD
                  </Button>
                </div>
              </>
            )}
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

      {!period.isAllTime ? (
        <Button variant="ghost" size="sm" onClick={selectAllTime} disabled={pending}>
          {ALL_TIME_LABEL}
        </Button>
      ) : null}
    </div>
  );
}

function ModeTab({
  label,
  active,
  disabled,
  onSelect,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "rounded-sm px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {label}
    </button>
  );
}
