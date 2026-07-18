"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import { todayIST } from "@/lib/dates";

/**
 * A native date input whose value/onChange work in terms of `Date`
 * objects (IST midnight, matching lib/dates.ts's convention) instead of
 * the raw "YYYY-MM-DD" string the DOM element uses. `blockFuture` caps
 * the picker at todayIST() — Section 7.4: "future dates blocked" — but
 * the SERVER re-validates with isAfterTodayIST regardless (Law 8).
 */
export const DateFieldIST = React.forwardRef<
  HTMLInputElement,
  {
    value?: Date | null | undefined;
    onChange: (date: Date | undefined) => void;
    onBlur?: () => void;
    name?: string;
    blockFuture?: boolean;
    disabled?: boolean;
  }
>(({ value, onChange, onBlur, name, blockFuture, disabled }, ref) => {
  const stringValue = value ? toDateInputValue(value) : "";

  return (
    <Input
      ref={ref}
      type="date"
      name={name}
      value={stringValue}
      max={blockFuture ? todayIST() : undefined}
      disabled={disabled}
      onBlur={onBlur}
      onChange={(e) => {
        const raw = e.target.value;
        onChange(raw ? new Date(`${raw}T00:00:00.000+05:30`) : undefined);
      }}
    />
  );
});
DateFieldIST.displayName = "DateFieldIST";

function toDateInputValue(d: Date): string {
  // Render using the date's own UTC fields shifted by the fixed IST
  // offset the app always constructs these instants with (IST midnight),
  // avoiding a dependency on the browser's local timezone.
  const istMs = d.getTime() + 5.5 * 60 * 60 * 1000;
  const istDate = new Date(istMs);
  const year = istDate.getUTCFullYear();
  const month = String(istDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(istDate.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
