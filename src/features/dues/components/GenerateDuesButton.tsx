"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { generateDuesAction } from "@/features/dues/actions";

/**
 * Runs the recurring-billing job on demand.
 *
 * The same job runs nightly on a schedule, but a schedule only exists in a
 * deployed environment — so locally, and on any day someone needs the next
 * period raised right now, there was previously no way to trigger it at all.
 * That absence is a large part of why the system felt like "nothing happens
 * when I add a client".
 *
 * Safe to press repeatedly: the job only creates periods that have actually
 * started and don't already exist, so a second press is a no-op rather than
 * a way to double-bill.
 */
export function GenerateDuesButton() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [result, setResult] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function run() {
    startTransition(async () => {
      const response = await generateDuesAction();
      if (!response.success) {
        setResult(response.message);
        return;
      }

      const { created, scanned, skipped, failed } = response.data;
      const parts = [
        created === 0
          ? "No new dues were due to be raised."
          : `${created} due${created === 1 ? "" : "s"} generated.`,
        `${scanned} retainer${scanned === 1 ? "" : "s"} checked, ${skipped} already up to date.`,
      ];
      if (failed.length > 0) {
        parts.push(
          `${failed.length} could not be processed: ${failed.map((f) => `${f.clientName} (${f.error})`).join("; ")}`
        );
      }
      setResult(parts.join(" "));
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={pending}>
        <RefreshCw className="size-3.5" />
        {pending ? "Generating…" : "Generate Dues"}
      </Button>

      <ConfirmDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setResult(null);
        }}
        title="Generate dues now?"
        description="Raises the next billing period for every active retainer whose current period has already ended. Clients that are already up to date are left alone, so running this twice changes nothing."
        confirmLabel="Generate"
        onConfirm={run}
      />

      {result ? <p className="text-sm text-muted-foreground">{result}</p> : null}
    </>
  );
}
