type AuditRow = {
  _id: unknown;
  action: string;
  summary: string;
  actorName: string;
  createdAt: Date;
};

// Section 7.4 "activity" tab — AuditLog entries for this client, newest
// first.
export function ActivityTab({ entries }: { entries: AuditRow[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No activity recorded yet.</p>;
  }

  return (
    <div className="grid gap-2">
      {entries.map((entry) => (
        <div key={String(entry._id)} className="border-b py-2 text-sm last:border-b-0">
          <div className="flex items-center justify-between">
            <span className="font-medium">{entry.action.replace(/_/g, " ")}</span>
            <span className="text-xs text-muted-foreground">
              {new Date(entry.createdAt).toLocaleString("en-IN", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </span>
          </div>
          <p className="text-muted-foreground">{entry.summary}</p>
          <p className="text-xs text-muted-foreground">by {entry.actorName}</p>
        </div>
      ))}
    </div>
  );
}
