"use client";

import * as React from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Section 12 — destructive/corrective actions (Reverse, Archive) require
 * typing an exact keyword before the confirm button enables, plus a
 * concrete consequence sentence with real numbers (not a generic
 * "are you sure?").
 */
export function TypedConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  keyword,
  confirmLabel = "Confirm",
  onConfirm,
  extraField,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  keyword: string;
  confirmLabel?: string;
  onConfirm: () => void | Promise<void>;
  /** e.g. a reason textarea rendered above the type-to-confirm input. */
  extraField?: React.ReactNode;
}) {
  const [typed, setTyped] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const matches = typed.trim() === keyword;

  function handleOpenChange(next: boolean) {
    if (!next) setTyped("");
    onOpenChange(next);
  }

  async function handleConfirm() {
    if (!matches) return;
    setPending(true);
    try {
      await onConfirm();
      handleOpenChange(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          {extraField}
          <div className="grid gap-1.5">
            <Label htmlFor="typed-confirm-input">
              Type <span className="font-mono font-semibold">{keyword}</span> to confirm
            </Label>
            <Input
              id="typed-confirm-input"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={!matches || pending}>
            {pending ? "Working…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
