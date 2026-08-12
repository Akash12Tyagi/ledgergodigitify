import { redirect } from "next/navigation";
import { cookies } from "next/headers";

import { requireUser } from "@/server/auth/guards";
import { AppError } from "@/lib/errors";
import { isTheme, THEME_COOKIE } from "@/lib/theme";
import { AppSidebar } from "@/components/shared/AppSidebar";
import { AppTopbar } from "@/components/shared/AppTopbar";
import { getPendingExpenseCount } from "@/server/services/expenses.service";

// Section 10.4 — the proxy's session-cookie check is presence-level only;
// this layout is the AUTHORITATIVE check, re-reading the session (and,
// inside requireUser, the user's role fresh from the DB) on every request.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let user;
  try {
    user = await requireUser("viewer");
  } catch (error) {
    if (error instanceof AppError) {
      redirect("/login");
    }
    throw error;
  }

  const cookieStore = await cookies();
  const cookieTheme = cookieStore.get(THEME_COOKIE)?.value;
  const theme = isTheme(cookieTheme) ? cookieTheme : "light";

  // Resolved here rather than inside the sidebar so the shell stays a
  // client component with no data access of its own (Section 3 layering).
  const pendingExpenses = await getPendingExpenseCount();

  return (
    <div className="flex h-screen overflow-hidden">
      <AppSidebar role={user.role} badges={{ pendingExpenses }} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <AppTopbar name={user.name} role={user.role} theme={theme} />
        <main id="main-content" className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1440px] p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
