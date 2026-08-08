import { AmountText } from "@/components/shared/AmountText";
import { StatusBadge, type DisplayStatus } from "@/components/shared/StatusBadge";
import { EmptyState } from "@/components/shared/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { DueSheet } from "@/features/dues/components/DueSheet";
import { DeleteDueButton } from "@/features/dues/components/DeleteDueButton";
import { RecordPaymentSheet } from "@/features/payments/components/RecordPaymentSheet";
import { Button } from "@/components/ui/button";
import { formatINR } from "@/lib/money";
import type { ClientDue } from "@/types/engine";
import type { UserRole } from "@/constants/roles";

export type DueEntry = { due: ClientDue; paymentCount: number };

/**
 * Every billing period for the client, open ones first, each with its own
 * Record Payment button.
 *
 * That per-period button is the whole point: payment used to be possible
 * only against "this calendar month's billing", so a client on a
 * 20th-to-20th cycle — or one who had fallen two periods behind — had no way
 * to settle the period that was actually owed.
 */
export function DuesTab({
  clientId,
  clientAmountPaise,
  clientArchived,
  entries,
  role,
}: {
  clientId: string;
  clientAmountPaise: number;
  clientArchived: boolean;
  entries: DueEntry[];
  role: UserRole;
}) {
  const canEdit = role === "owner" || role === "admin" || role === "staff";
  const canDelete = role === "owner" || role === "admin";

  const open = entries.filter((e) => e.due.remainingPaise > 0);
  const settled = entries.filter((e) => e.due.remainingPaise <= 0);
  const totalOpen = open.reduce((sum, e) => sum + e.due.remainingPaise, 0);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {open.length === 0
            ? "Nothing outstanding."
            : `${open.length} open period${open.length === 1 ? "" : "s"} · ${formatINR(totalOpen)} outstanding`}
        </p>
        {canEdit && !clientArchived ? (
          <DueSheet clientId={clientId} defaultAmountPaise={clientAmountPaise} />
        ) : null}
      </div>

      {entries.length === 0 ? (
        <EmptyState title="No dues raised yet" />
      ) : (
        <div className="grid gap-2">
          {[...open, ...settled].map(({ due, paymentCount }) => (
            <DueCard
              key={due.id}
              due={due}
              paymentCount={paymentCount}
              clientId={clientId}
              clientAmountPaise={clientAmountPaise}
              clientArchived={clientArchived}
              canEdit={canEdit}
              canDelete={canDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DueCard({
  due,
  paymentCount,
  clientId,
  clientAmountPaise,
  clientArchived,
  canEdit,
  canDelete,
}: {
  due: ClientDue;
  paymentCount: number;
  clientId: string;
  clientAmountPaise: number;
  clientArchived: boolean;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const isOpen = due.remainingPaise > 0;
  // A due with any payment history — including a reversed one — is frozen:
  // re-dating or deleting it would change what an issued receipt refers to.
  // The server enforces this; mirroring it here keeps buttons off screen
  // rather than offering an action that can only fail.
  const isFrozen = paymentCount > 0;

  return (
    <Card size="sm">
      <CardContent className="grid gap-2 py-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <p className="font-medium">{due.periodLabel}</p>
              <StatusBadge status={due.status as DisplayStatus} />
              {due.generatedBy === "manual" ? (
                <span className="text-xs text-muted-foreground">manual</span>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              Due{" "}
              {new Date(due.dueDate).toLocaleDateString("en-IN", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}
              {due.daysOverdue > 0 ? (
                <span className="text-money-out">
                  {" "}
                  · {due.daysOverdue} day{due.daysOverdue === 1 ? "" : "s"} overdue
                </span>
              ) : null}
            </p>
            {due.note ? <p className="mt-1 text-xs text-muted-foreground">{due.note}</p> : null}
          </div>

          <div className="text-right">
            <AmountText paise={due.remainingPaise} tone={isOpen ? "out" : "neutral"} />
            <p className="text-xs text-muted-foreground">
              {formatINR(due.paidPaise)} paid of{" "}
              {formatINR(due.billedPaise + due.carriedInPaise)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {isOpen && !clientArchived ? (
            <RecordPaymentSheet
              clientId={clientId}
              monthlyBillingId={due.id}
              remainingPaise={due.remainingPaise}
              periodLabel={due.periodLabel}
              trigger={<Button size="sm" />}
              triggerLabel="Record Payment"
            />
          ) : null}

          {canEdit && !isFrozen ? (
            <DueSheet
              clientId={clientId}
              defaultAmountPaise={clientAmountPaise}
              due={due}
              trigger={<Button variant="ghost" size="sm" />}
              triggerLabel="Edit"
            />
          ) : null}

          {canDelete && !isFrozen ? (
            <DeleteDueButton
              dueId={due.id}
              amountPaise={due.billedPaise}
              periodLabel={due.periodLabel}
            />
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
