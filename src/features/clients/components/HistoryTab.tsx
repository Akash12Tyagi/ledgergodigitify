import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge, type DisplayStatus } from "@/components/shared/StatusBadge";
import { formatINR } from "@/lib/money";
import type { ClientDue } from "@/types/engine";

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

// One card per billing period, newest first (getClientDues already sorts
// desc), with that period's payment table — invoice number, receipt number,
// method and which account the money landed in.
export function HistoryTab({
  entries,
  accountNameById,
}: {
  entries: { due: ClientDue; trail: TrailPayment[] }[];
  accountNameById: Map<string, string>;
}) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No billing history yet.</p>;
  }

  return (
    <div className="grid gap-3">
      {entries.map(({ due, trail }) => (
        <Card key={due.id} size="sm">
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              <span>{due.periodLabel}</span>
              <StatusBadge status={due.status as DisplayStatus} />
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <p className="text-muted-foreground">
              Billed {formatINR(due.billedPaise)}
              {due.carriedInPaise > 0 ? ` + ${formatINR(due.carriedInPaise)} carried` : ""} · Paid{" "}
              {formatINR(due.paidPaise)} · Remaining {formatINR(due.remainingPaise)}
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
                        className={
                          payment.status === "reversed" ? "text-muted-foreground line-through" : ""
                        }
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
                        <td className="px-2 py-1.5">
                          {accountNameById.get(String(payment.accountId)) ?? "—"}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {formatINR(payment.amountPaise)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No payments recorded for this period.</p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
