"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import {
  pauseExpenseTemplateAction,
  resumeExpenseTemplateAction,
} from "@/features/expense-templates/actions";

/**
 * The "de-activate" control. Pausing is deliberately not deletion: the
 * template and every expense it already raised stay exactly where they are,
 * so history keeps making sense — only future periods stop.
 *
 * The resume copy spells out that the paused stretch is NOT backfilled,
 * because that is the one thing a user could reasonably expect either way.
 */
export function PauseResumeTemplateButton({
  templateId,
  status,
  paidToEntity,
}: {
  templateId: string;
  status: "active" | "paused";
  paidToEntity: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const isPaused = status === "paused";

  async function handleConfirm(): Promise<boolean> {
    setError(null);

    if (isPaused) {
      const result = await resumeExpenseTemplateAction({ templateId });
      if (!result.success) {
        setError(result.message);
        return false;
      }
      router.refresh();
      return true;
    }

    if (reason.trim().length < 2) {
      setError("Enter a reason.");
      return false;
    }
    const result = await pauseExpenseTemplateAction({ templateId, reason: reason.trim() });
    if (!result.success) {
      setError(result.message);
      return false;
    }
    router.refresh();
    return true;
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {isPaused ? "Resume" : "Pause"}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setReason("");
            setError(null);
          }
        }}
        title={isPaused ? "Resume this recurring expense?" : "Pause this recurring expense?"}
        confirmLabel={isPaused ? "Resume" : "Pause"}
        description={
          isPaused
            ? `New periods for ${paidToEntity} will start being raised again from the current period onwards. The months it was paused are not backfilled.`
            : `No new periods will be raised for ${paidToEntity}. Anything already awaiting approval stays — cancel those separately if they should not be paid.`
        }
        extraField={
          <div className="grid gap-1.5">
            {isPaused ? null : (
              <>
                <Label htmlFor="pause-template-reason">Reason</Label>
                <Textarea
                  id="pause-template-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </>
            )}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        }
        onConfirm={handleConfirm}
      />
    </>
  );
}
