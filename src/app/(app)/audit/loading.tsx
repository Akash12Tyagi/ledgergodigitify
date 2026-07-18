import { Skeleton } from "@/components/ui/skeleton";

export default function AuditLoading() {
  return (
    <div className="grid gap-4">
      <Skeleton className="h-9 w-32" />
      <div className="flex justify-end">
        <Skeleton className="h-9 w-40" />
      </div>
      <div className="grid gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-11 w-full" />
        ))}
      </div>
    </div>
  );
}
