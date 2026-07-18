import { AmountText } from "@/components/shared/AmountText";
import { formatINR } from "@/lib/money";
import type { ClientMonthStatus } from "@/types/engine";

// Section 7.4 "dues" tab — per-month remaining + total, with an
// explanatory line for carries.
export function DuesTab({ history }: { history: ClientMonthStatus[] }) {
  const outstanding = history.filter((h) => h.remainingPaise > 0);
  const total = outstanding.reduce((sum, h) => sum + h.remainingPaise, 0);

  if (outstanding.length === 0) {
    return <p className="text-sm text-muted-foreground">No outstanding dues.</p>;
  }

  return (
    <div className="grid gap-3">
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left">Month</th>
              <th className="px-3 py-2 text-left">Due date</th>
              <th className="px-3 py-2 text-right">Remaining</th>
            </tr>
          </thead>
          <tbody>
            {outstanding.map((h) => (
              <tr key={h.monthKey} className="border-t">
                <td className="px-3 py-2">
                  {h.monthKey}
                  {h.carriedInPaise > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Includes {formatINR(h.carriedInPaise)} carried forward
                    </p>
                  ) : null}
                </td>
                <td className="px-3 py-2">
                  {new Date(h.dueDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                </td>
                <td className="px-3 py-2 text-right">
                  <AmountText paise={h.remainingPaise} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-right font-semibold">Total: {formatINR(total)}</p>
    </div>
  );
}
