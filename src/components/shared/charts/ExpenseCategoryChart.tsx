"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { formatINR } from "@/lib/money";
import type { ExpenseByCategoryRow } from "@/types/engine";

const COLORS = [
  "#dc2626",
  "#ea580c",
  "#d97706",
  "#65a30d",
  "#0d9488",
  "#0284c7",
  "#4f46e5",
  "#9333ea",
  "#db2777",
  "#78716c",
];

/** Section 7.5 — /ledger/overview's expense-by-category donut. Client-only,
 * always reached via next/dynamic(..., { ssr: false }) (Section 9). */
export function ExpenseCategoryChart({ rows }: { rows: ExpenseByCategoryRow[] }) {
  if (rows.length === 0) return null;

  const data = rows.map((r) => ({ name: r.category, value: r.totalPaise / 100 }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>
          {data.map((entry, i) => (
            <Cell key={entry.name} fill={COLORS[i % COLORS.length] ?? "#78716c"} />
          ))}
        </Pie>
        <Tooltip
          formatter={(value) => formatINR(Math.round(Number(value) * 100))}
          contentStyle={{ fontSize: 12, borderRadius: 8 }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
