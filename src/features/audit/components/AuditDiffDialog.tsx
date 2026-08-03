"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatINR } from "@/lib/money";
import type { AuditLogRow } from "@/types/audit-log";

// "clientId" -> "Client Id", "amountPaise" -> "Amount", "openingBalancePaise"
// -> "Opening Balance". "Id" is kept (the value is still a raw ObjectId, so
// the label should keep signaling that); "Paise" is dropped because
// humanizeValue reformats those fields as rupees, making the suffix stale.
function humanizeKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(" ")
    .filter((w) => w !== "Paise");
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") || key;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function humanizeValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (key.endsWith("Paise") && typeof value === "number") return formatINR(value);
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

// Admin-only view (requireUser("admin")) — this is a readability pass over
// raw stored field names/values, not a redaction layer. Plain objects render
// as a humanized key-value list; anything else (arrays, primitives) falls
// back to raw JSON, same as before.
function Pane({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="grid gap-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {value === null || value === undefined ? (
        <p className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">—</p>
      ) : isPlainObject(value) ? (
        <dl className="max-h-80 overflow-auto rounded-lg border bg-muted/30 p-3 text-xs">
          {Object.entries(value).map(([key, val]) => (
            <div key={key} className="flex items-baseline justify-between gap-3 py-0.5">
              <dt className="text-muted-foreground">{humanizeKey(key)}</dt>
              <dd className="text-right font-medium">{humanizeValue(key, val)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <pre className="max-h-80 overflow-auto rounded-lg border bg-muted/30 p-3 text-xs">
          {JSON.stringify(value, null, 2)}
        </pre>
      )}
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
