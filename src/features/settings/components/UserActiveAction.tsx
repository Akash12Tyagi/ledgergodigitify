"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { TypedConfirmDialog } from "@/components/shared/TypedConfirmDialog";
import { deactivateUserAction, reactivateUserAction } from "@/features/settings/actions";

export function UserActiveAction({
  userId,
  isActive,
  isSelf,
  name,
}: {
  userId: string;
  isActive: boolean;
  isSelf: boolean;
  name: string;
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleReactivate() {
    const result = await reactivateUserAction(userId);
    if (!result.success) {
      setError(result.message);
      return;
    }
    router.refresh();
  }

  async function handleDeactivate() {
    const result = await deactivateUserAction(userId);
    if (!result.success) {
      setError(result.message);
      return;
    }
    router.refresh();
  }

  if (isSelf) return null;

  return (
    <>
      {isActive ? (
        <Button variant="ghost" size="sm" onClick={() => setConfirmOpen(true)}>
          Deactivate
        </Button>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => void handleReactivate()}>
          Reactivate
        </Button>
      )}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <TypedConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Deactivate this user?"
        keyword="DEACTIVATE"
        confirmLabel="Deactivate"
        description={`${name} will no longer be able to sign in. This can be undone by reactivating them later.`}
        onConfirm={handleDeactivate}
      />
    </>
  );
}
