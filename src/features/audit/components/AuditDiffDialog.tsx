"use client";

import * as React from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatINR } from "@/lib/money";
import type { AuditLogRow } from "@/types/audit-log";
import type { AuditEntityKind } from "@/constants/audit-actions";

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

/**
 * The full IST timestamp, to the second.
 *
 * The table column rounds to the minute, which is fine for scanning and
 * useless for the question this dialog exists to answer — "which of these
 * two happened first". Seconds are what separate a double-submit from a
 * deliberate second entry.
 */
function formatFullIST(iso: string): string {
  return `${new Date(iso).toLocaleString("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  })} IST`;
}

/** Where the record this entry describes actually lives, when it has a page
 * of its own. Kinds without one (auth, system, settings) return null rather
 * than linking somewhere that will 404. */
function entityHref(kind: AuditEntityKind, id: string | null): string | null {
  if (!id) return null;
  switch (kind) {
    case "client":
      return `/clients/${id}`;
    case "account":
    case "transfer":
      return `/ledger/accounts/${id}`;
    default:
      return null;
  }
}

function Field({
  label,
  children,
  mono,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={mono ? "font-mono text-xs break-all" : "text-sm wrap-break-word"}>{children}</dd>
    </div>
  );
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

/**
 * Section 7.12 — the full record of one audit entry.
 *
 * Opens for EVERY entry, not only those carrying a before/after. It used to
 * hide itself when both were null, which silently made whole classes of
 * event — logins, exports, cron runs — unreadable past their one-line
 * summary, exactly the entries you most want to inspect after something
 * goes wrong. An entry with no field-level diff still has a who, a when, a
 * from-where and an entity id, and those are the audit trail.
 */
export function AuditDiffDialog({ entry }: { entry: AuditLogRow }) {
  const [open, setOpen] = React.useState(false);
  const href = entityHref(entry.entityKind, entry.entityId);
  const hasDiff = entry.before !== null || entry.after !== null;

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Details
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{entry.summary}</DialogTitle>
          </DialogHeader>

          <div className="grid max-h-[70vh] gap-4 overflow-y-auto">
            <dl className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2">
              <Field label="When">{formatFullIST(entry.createdAt)}</Field>
              <Field label="Action" mono>
                {entry.action}
              </Field>

              <Field label="Actor">{entry.actorName}</Field>
              <Field label="Actor user id" mono>
                {entry.actorUserId}
              </Field>

              <Field label="Entity">{entry.entityKind}</Field>
              <Field label="Entity id" mono>
                {entry.entityId ? (
                  href ? (
                    <Link href={href} className="underline underline-offset-2 hover:text-foreground">
                      {entry.entityId}
                    </Link>
                  ) : (
                    entry.entityId
                  )
                ) : (
                  "—"
                )}
              </Field>

              {/* Null for anything the cron wrote — there is no request, and
                  therefore no address, behind a scheduled job. */}
              <Field label="IP address" mono>
                {entry.ip ?? "—"}
              </Field>
              <Field label="Device" mono>
                {entry.userAgent ?? "—"}
              </Field>

              <Field label="Audit entry id" mono>
                {entry.id}
              </Field>
            </dl>

            {hasDiff ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Pane label="Before" value={entry.before} />
                <Pane label="After" value={entry.after} />
              </div>
            ) : (
              <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                No field-level changes were recorded for this action — the entry above is the
                complete record of it.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
