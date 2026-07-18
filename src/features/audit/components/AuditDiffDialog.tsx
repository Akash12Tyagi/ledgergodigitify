"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { AuditLogRow } from "@/types/audit-log";

function Pane({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="grid gap-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <pre className="max-h-80 overflow-auto rounded-lg border bg-muted/30 p-3 text-xs">
        {value === null || value === undefined ? "—" : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

// Section 7.12 — the audit trail's before/after diff viewer.
export function AuditDiffDialog({ entry }: { entry: AuditLogRow }) {
  const [open, setOpen] = React.useState(false);

  if (entry.before === null && entry.after === null) return null;

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        View diff
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{entry.summary}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Pane label="Before" value={entry.before} />
            <Pane label="After" value={entry.after} />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
