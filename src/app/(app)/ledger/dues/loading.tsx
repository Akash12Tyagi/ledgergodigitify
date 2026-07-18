import { Skeleton } from "@/components/ui/skeleton";

export default function LedgerDuesLoading() {
  return (
    <div className="grid gap-6">
      <Skeleton className="h-9 w-32" />
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-32 w-full" />
      ))}
    </div>
  );
}
