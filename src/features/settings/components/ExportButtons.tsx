import { Download } from "lucide-react";

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
  );
}
