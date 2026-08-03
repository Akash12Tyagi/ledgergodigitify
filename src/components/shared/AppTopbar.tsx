"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut, Menu, UserCircle } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { NotificationBell } from "@/features/notifications/components/NotificationBell";
import { useMobileNavStore } from "@/components/shared/mobile-nav-store";
import type { Theme } from "@/lib/theme";
import type { UserRole } from "@/constants/roles";
import { logoutAction } from "@/features/auth/actions";
import { initials } from "@/lib/utils";

// Section 7 — top bar: notification bell, theme toggle, user menu (name,
// role chip, Logout). Global search / month pill land in a later pass.
export function AppTopbar({
  name,
  role,
  theme,
}: {
  name: string;
  role: UserRole;
  theme: Theme;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const { setOpen: setMobileNavOpen } = useMobileNavStore();

  function handleLogout() {
    startTransition(async () => {
      await logoutAction();
      router.push("/login");
      router.refresh();
    });
  }

  return (
    <header className="flex h-14 items-center justify-between gap-2 border-b px-4 md:justify-end">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Open navigation menu"
        className="md:hidden"
        onClick={() => setMobileNavOpen(true)}
      >
        <Menu className="size-5" />
      </Button>
      <div className="flex items-center gap-2">
        <NotificationBell />
        <ThemeToggle theme={theme} />
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" className="h-9 gap-2 px-1.5" />}>
            <Avatar className="size-6">
              <AvatarFallback className="text-[11px]">{initials(name)}</AvatarFallback>
            </Avatar>
            <span className="max-w-32 truncate text-sm">{name}</span>
            <Badge variant="outline" className="capitalize">
              {role}
            </Badge>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{name}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link href="/profile" />}>
              <UserCircle />
              Profile
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} disabled={pending} variant="destructive">
              <LogOut />
              {pending ? "Signing out…" : "Logout"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
