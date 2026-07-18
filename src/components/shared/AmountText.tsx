import { formatINR } from "@/lib/money";
import { cn } from "@/lib/utils";

// Section 12 — right-aligned, tabular, sign & color by direction; never
// wraps; compact mode ("₹1.2L") is FORBIDDEN here — exact numbers only.
export type AmountTone = "neutral" | "auto" | "in" | "out";

export function AmountText({
  paise,
  tone = "neutral",
  showSign,
  className,
}: {
  paise: number;
  tone?: AmountTone;
  showSign?: boolean;
  className?: string;
}) {
  const formatted = formatINR(paise, showSign !== undefined ? { showSign } : undefined);
  const resolvedTone = tone === "auto" ? (paise > 0 ? "in" : paise < 0 ? "out" : "neutral") : tone;

  return (
    <span
      className={cn(
        "inline-block text-right font-medium whitespace-nowrap tabular-nums",
        resolvedTone === "in" && "text-money-in",
        resolvedTone === "out" && "text-money-out",
        className
      )}
    >
      {formatted}
    </span>
  );
}
