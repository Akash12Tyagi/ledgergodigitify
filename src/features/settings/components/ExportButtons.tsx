import { Download, DatabaseBackup, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const EXPORTS = [
  { href: "/api/export/clients", label: "Clients" },
  { href: "/api/export/expenses", label: "Expenses" },
  { href: "/api/export/credits", label: "Credits" },
  { href: "/api/export/transactions", label: "Transactions (this month)" },
];

// Section 7.13 — CSV exports. Plain GET links (browser handles the
// download via Content-Disposition); the CSV rows are produced by the
// exact same list functions the corresponding screen uses.
export function ExportButtons() {
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Export</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {EXPORTS.map((item) => (
            <Button key={item.href} variant="outline" size="sm" render={<a href={item.href} />}>
              <Download className="size-4" />
              {item.label}
            </Button>
          ))}
        </CardContent>
      </Card>

      {/* Deliberately its own card, not another chip in the row above. The
          CSVs are one screen's rows; this is the whole business in a file,
          and the two should not look like the same kind of action. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Full backup</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <p className="text-sm text-muted-foreground">
            Every collection in one Excel file — one sheet each, with the MongoDB ids intact, so
            it can be restored into a fresh database. Take one whenever you like; each download is
            a complete point-in-time copy that stands on its own.
          </p>

          <div className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/5 px-3 py-2">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warn" />
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-warn">Treat this file like the database.</span> It
              contains every financial record and the password hashes behind every login. Keep it
              encrypted, and never in a shared or synced folder by accident.
            </p>
          </div>

          <div>
            <Button variant="outline" size="sm" render={<a href="/api/export/backup" />}>
              <DatabaseBackup className="size-4" />
              Download full backup (.xlsx)
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            Restore:{" "}
            <code className="rounded bg-muted px-1 py-0.5">
              npm run restore-from-xlsx -- --file &lt;file&gt; --uri &lt;target db&gt;
            </code>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
