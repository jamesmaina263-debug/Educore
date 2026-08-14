import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell/app-shell";
import { logout } from "@/app/login/actions";
import type { FinanceContext } from "@/app/finance/_data";

export function FinancePageShell({
  ctx,
  section,
  title,
  subtitle,
  children,
}: {
  ctx: FinanceContext;
  section: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const breadcrumbs = [
    { label: ctx.schoolName, href: "/dashboard" },
    { label: "Finance", href: "/finance/dashboard" },
    { label: section },
  ];

  if (!ctx.canRead) {
    return (
      <AppShell breadcrumbs={breadcrumbs} userName={ctx.userName} userRole={ctx.userRole} onSignOut={logout}>
        <div className="panel border-dashed p-10 text-center text-sm text-muted-foreground">
          You don&apos;t have access to Finance.
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={breadcrumbs} userName={ctx.userName} userRole={ctx.userRole} onSignOut={logout}>
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-lg font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground">
            {subtitle ?? `${ctx.activeTermName ?? "No active term"} · ${ctx.schoolName}`}
          </p>
        </div>
        {children}
      </div>
    </AppShell>
  );
}
