"use client";

import * as React from "react";

// See SparklineChartLazy.tsx's comment — same reasoning, same fix.
const ExpenseCategoryChart = React.lazy(() =>
  import("@/components/shared/charts/ExpenseCategoryChart").then((m) => ({ default: m.ExpenseCategoryChart }))
);

export function ExpenseCategoryChartLazy(props: React.ComponentProps<typeof ExpenseCategoryChart>) {
  return (
    <React.Suspense fallback={<div className="h-[220px]" />}>
      <ExpenseCategoryChart {...props} />
    </React.Suspense>
  );
}
