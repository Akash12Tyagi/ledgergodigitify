"use client";

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { formatINR } from "@/lib/money";
import { formatMonthLabel } from "@/lib/dates";
import type { SparklinePoint } from "@/types/engine";

/**
 * Section 7.1 — the dashboard's 6-month collected-vs-expenses sparkline.
 * Client-only (Recharts needs the DOM) and always reached via
 * `next/dynamic(..., { ssr: false })` from the server page (Section 9 —
 * below-the-fold, never blocks the initial RSC paint).
 */
export function SparklineChart({ points }: { points: SparklinePoint[] }) {
  const data = points.map((p) => ({
    month: formatMonthLabel(p.monthKey).split(" ")[0]?.slice(0, 3) ?? p.monthKey,
    Collected: p.collectedPaise / 100,
    Expenses: p.expensesPaise / 100,
  }));

  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <XAxis dataKey="month" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
        <YAxis hide />
        <Tooltip
          formatter={(value) => formatINR(Math.round(Number(value) * 100))}
          contentStyle={{ fontSize: 12, borderRadius: 8 }}
        />
        <Line type="monotone" dataKey="Collected" stroke="var(--color-money-in, #16a34a)" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="Expenses" stroke="var(--color-money-out, #dc2626)" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
