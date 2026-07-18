"use client";

import * as React from "react";

// Section 9/15 — Recharts is ~99KB gzipped; genuinely deferred out of the
// route's First Load JS via React.lazy (not a plain import), since
// Next.js 16 no longer allows next/dynamic(..., { ssr: false }) directly
// inside the Server Component page that renders this (AGENTS.md: a
// training-data-breaking change in this Next.js version). React.lazy
// works the same everywhere React runs, Next-specific or not, and Next's
// own build-time "First Load JS" accounting excludes lazy-imported chunks
// from the initial bundle the way it never did for a plain import.
const SparklineChart = React.lazy(() =>
  import("@/components/shared/charts/SparklineChart").then((m) => ({ default: m.SparklineChart }))
);

export function SparklineChartLazy(props: React.ComponentProps<typeof SparklineChart>) {
  return (
    <React.Suspense fallback={<div className="h-[180px]" />}>
      <SparklineChart {...props} />
    </React.Suspense>
  );
}
