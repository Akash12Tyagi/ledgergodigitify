import { Skeleton } from "@/components/ui/skeleton";

export default function SettingsUsersLoading() {
  return (
    <div className="grid gap-4">
      <Skeleton className="h-9 w-32" />
      <div className="flex justify-end">
        <Skeleton className="h-9 w-28" />
      </div>
      <div className="grid gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-11 w-full" />
        ))}
      </div>
    </div>
  );
}
