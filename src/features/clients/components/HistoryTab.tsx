import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatINR } from "@/lib/money";
import type { ClientMonthStatus } from "@/types/engine";

type TrailPayment = {
  _id: unknown;
  amountPaise: number;
  paidAt: Date;
  method: string;
  invoiceNumber: string;
  receiptNumber: string;
  accountId: unknown;
  status: string;
};

// Section 7.4 "history" tab — one card per past month, most recent first
// (getClientHistory already sorts desc), with that month's payment table.
export function HistoryTab({
  entries,
  accountNameById,
}: {
  entries: { monthStatus: ClientMonthStatus; trail: TrailPayment[] }[];
  accountNameById: Map<string, string>;
}) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No billing history yet.</p>;
  }

  return (
    <div className="grid gap-3">
      {entries.map(({ monthStatus, trail }) => (
        <Card key={monthStatus.monthKey} size="sm">
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              <span>{monthStatus.monthKey}</span>
              <StatusBadge status={monthStatus.status} />
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <p className="text-muted-foreground">
              Billed {formatINR(monthStatus.billedPaise)}
              {monthStatus.carriedInPaise > 0
                ? ` + ${formatINR(monthStatus.carriedInPaise)} carried`
                : ""}{" "}
              · Paid {formatINR(monthStatus.paidPaise)} · Remaining{" "}
              {formatINR(monthStatus.remainingPaise)}
            </p>
            {trail.length > 0 ? (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-2 py-1.5 text-left">Invoice</th>
                      <th className="px-2 py-1.5 text-left">Receipt</th>
                      <th className="px-2 py-1.5 text-left">Date</th>
                      <th className="px-2 py-1.5 text-left">Method</th>
                      <th className="px-2 py-1.5 text-left">Account</th>
                      <th className="px-2 py-1.5 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trail.map((payment) => (
                      <tr
                        key={String(payment._id)}
                        className={payment.status === "reversed" ? "text-muted-foreground line-through" : ""}
                      >
                        <td className="px-2 py-1.5">{payment.invoiceNumber}</td>
                        <td className="px-2 py-1.5">{payment.receiptNumber}</td>
                        <td className="px-2 py-1.5">
                          {new Date(payment.paidAt).toLocaleDateString("en-IN", {
                            day: "2-digit",
                            month: "short",
                          })}
                        </td>
                        <td className="px-2 py-1.5 capitalize">{payment.method.replace("_", " ")}</td>
                        <td className="px-2 py-1.5">{accountNameById.get(String(payment.accountId)) ?? "—"}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {formatINR(payment.amountPaise)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
