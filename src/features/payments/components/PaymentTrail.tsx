import { StatusBadge } from "@/components/shared/StatusBadge";
import { ReversePaymentButton } from "@/features/payments/components/ReversePaymentButton";
import { formatINR } from "@/lib/money";
import type { UserRole } from "@/constants/roles";

type TrailPayment = {
  id: string;
  amountPaise: number;
  paidAt: string;
  method: string;
  receiptNumber: string;
  accountName: string;
  status: "active" | "reversed";
  reversedReason: string | null;
};

const METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  upi: "UPI",
  bank_transfer: "Bank Transfer",
  cheque: "Cheque",
  card: "Card",
  other: "Other",
};

// Section 7.4 — the payment trail as a visible equation. Reversed
// payments stay listed, struck through, with their reason as a tooltip.
export function PaymentTrail({
  payments,
  billedPaise,
  carriedInPaise,
  paidPaise,
  remainingPaise,
  status,
  role,
}: {
  payments: TrailPayment[];
  billedPaise: number;
  carriedInPaise: number;
  paidPaise: number;
  remainingPaise: number;
  status: string;
  role: UserRole;
}) {
  const canReverse = role === "owner" || role === "admin";

  if (payments.length === 0) {
    return <p className="text-sm text-muted-foreground">No payments recorded for this month yet.</p>;
  }

  return (
    <div className="grid gap-2">
      {carriedInPaise > 0 ? (
        <p className="text-sm text-muted-foreground">
          Includes {formatINR(carriedInPaise)} carried from a previous month.
        </p>
      ) : null}
      {payments.map((payment) => (
        <div
          key={payment.id}
          className="flex items-center justify-between gap-3 border-b py-2 last:border-b-0"
          title={payment.status === "reversed" ? `Reversed: ${payment.reversedReason ?? ""}` : undefined}
        >
          <div className={payment.status === "reversed" ? "text-muted-foreground line-through" : ""}>
            <span className="font-medium">{formatINR(payment.amountPaise)}</span>{" "}
            <span className="text-sm text-muted-foreground">
              {new Date(payment.paidAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} ·{" "}
              {METHOD_LABELS[payment.method] ?? payment.method} · {payment.receiptNumber} · into{" "}
              {payment.accountName}
            </span>
          </div>
          {payment.status === "active" && canReverse ? (
            <ReversePaymentButton
              paymentId={payment.id}
              amountPaise={payment.amountPaise}
              receiptNumber={payment.receiptNumber}
            />
          ) : null}
        </div>
      ))}
      <div className="flex items-center justify-between border-t pt-2">
        <span className="font-semibold">
          = {formatINR(paidPaise)} paid · {formatINR(remainingPaise)} remaining
        </span>
        <StatusBadge status={status as never} />
      </div>
      <p className="text-xs text-muted-foreground">Billed this month: {formatINR(billedPaise)}</p>
    </div>
  );
}
