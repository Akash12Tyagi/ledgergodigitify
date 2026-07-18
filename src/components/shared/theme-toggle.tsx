"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Theme } from "@/lib/theme";
import { setThemeAction } from "@/components/shared/theme-actions";

export function ThemeToggle({ theme }: { theme: Theme }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    startTransition(async () => {
      await setThemeAction(next);
      router.refresh();
    });
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      onClick={toggle}
      disabled={pending}
    >
      {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}
