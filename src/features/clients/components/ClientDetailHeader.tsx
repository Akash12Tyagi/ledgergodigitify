"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusBadge, type DisplayStatus } from "@/components/shared/StatusBadge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { TypedConfirmDialog } from "@/components/shared/TypedConfirmDialog";
import { EditClientSheet } from "@/features/clients/components/EditClientSheet";
import { formatINR } from "@/lib/money";
import {
  archiveClientAction,
  pauseClientAction,
  resumeClientAction,
  unarchiveClientAction,
} from "@/features/clients/actions";
import type { UserRole } from "@/constants/roles";

type ClientDetailHeaderProps = {
  client: {
    id: string;
    name: string;
    service: string;
    engagementType: "retainer" | "one_time";
    status: "active" | "paused" | "archived";
    amountPaise: number;
    nextDueDate: string;
    email: string | null;
    phone: string | null;
    company: string | null;
    address: string | null;
    gstin: string | null;
    notes: string | null;
    version: number;
  };
  totalDuePaise: number;
  /** Rendered as-is next to Edit — kept as a slot (rather than importing
   * RecordPaymentSheet from the payments feature here) so this component
   * doesn't cross features (Section 3); the page composes both. */
  recordPaymentSlot: React.ReactNode;
  role: UserRole;
  /** Section 14 edge case 27 — fully-paid one-time project. */
  showCompletionSuggestion?: boolean;
};

export function ClientDetailHeader({
  client,
  totalDuePaise,
  recordPaymentSlot,
  role,
  showCompletionSuggestion,
}: ClientDetailHeaderProps) {
  const router = useRouter();
  const [archiveOpen, setArchiveOpen] = React.useState(false);
  const [pauseOpen, setPauseOpen] = React.useState(false);

  const canEdit = role === "owner" || role === "admin" || role === "staff";
  const canArchive = role === "owner" || role === "admin";

  async function handlePause() {
    const action = client.status === "paused" ? resumeClientAction : pauseClientAction;
    const result = await action(client.id);
    if (result.success) router.refresh();
  }

  async function handleArchive() {
    const result = await archiveClientAction(client.id, null);
    if (result.success) router.refresh();
  }

  async function handleUnarchive() {
    const result = await unarchiveClientAction(client.id);
    if (result.success) router.refresh();
  }

  return (
    <div className="flex items-start justify-between gap-4 pb-6">
      <div className="grid gap-1">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold">{client.name}</h1>
          <StatusBadge status={client.status.toUpperCase() as DisplayStatus} />
        </div>
        <p className="text-sm text-muted-foreground">
          {client.service} · <span className="capitalize">{client.engagementType.replace("_", " ")}</span>
        </p>
        {showCompletionSuggestion ? (
          <button
            type="button"
            onClick={() => setArchiveOpen(true)}
            className="mt-1 w-fit rounded-full bg-money-in/10 px-2 py-0.5 text-xs font-medium text-money-in hover:bg-money-in/20"
          >
            Project complete — archive?
          </button>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {client.status !== "archived" ? recordPaymentSlot : null}
        {canEdit && client.status !== "archived" ? <EditClientSheet client={client} /> : null}

        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="More actions" />}>
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {client.status === "archived" ? (
              <DropdownMenuItem onClick={handleUnarchive}>Unarchive</DropdownMenuItem>
            ) : (
              <>
                <DropdownMenuItem onClick={() => setPauseOpen(true)}>
                  {client.status === "paused" ? "Resume" : "Pause"}
                </DropdownMenuItem>
                {canArchive ? (
                  <DropdownMenuItem variant="destructive" onClick={() => setArchiveOpen(true)}>
                    Archive
                  </DropdownMenuItem>
                ) : null}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ConfirmDialog
        open={pauseOpen}
        onOpenChange={setPauseOpen}
        title={client.status === "paused" ? "Resume this client?" : "Pause this client?"}
        description={
          client.status === "paused"
            ? "Rollover billing resumes from the current month — paused months are not back-billed."
            : "Rollover billing stops until resumed. Existing dues stay visible in Ledger → Dues."
        }
        confirmLabel={client.status === "paused" ? "Resume" : "Pause"}
        onConfirm={handlePause}
      />

      <TypedConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title="Archive this client?"
        keyword="ARCHIVE"
        confirmLabel="Archive"
        description={
          totalDuePaise > 0
            ? `${client.name} still owes ${formatINR(totalDuePaise)}. Archiving keeps the due visible in Dues.`
            : `${client.name} has no outstanding dues.`
        }
        onConfirm={handleArchive}
      />
    </div>
  );
}
