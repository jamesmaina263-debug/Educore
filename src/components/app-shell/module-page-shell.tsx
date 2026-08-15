import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell/app-shell";
import { logout } from "@/app/login/actions";

export function ModulePageShell({
  schoolName,
  userName,
  userRole,
  moduleLabel,
  moduleHref,
  section,
  title,
  subtitle,
  noAccess,
  children,
}: {
  schoolName: string;
  userName: string;
  userRole?: string;
  moduleLabel: string;
  moduleHref: string;
  section: string;
  title: string;
  subtitle?: string;
  noAccess?: boolean;
  children: ReactNode;
}) {
  const breadcrumbs = [
    { label: schoolName, href: "/dashboard" },
    { label: moduleLabel, href: moduleHref },
    { label: section },
  ];

  if (noAccess) {
    return (
      <AppShell breadcrumbs={breadcrumbs} userName={userName} userRole={userRole} onSignOut={logout}>
        <div className="panel border-dashed p-10 text-center text-sm text-muted-foreground">
          You don&apos;t have access to {moduleLabel}.
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={breadcrumbs} userName={userName} userRole={userRole} onSignOut={logout}>
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-lg font-semibold">{title}</h1>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {children}
      </div>
    </AppShell>
  );
}
