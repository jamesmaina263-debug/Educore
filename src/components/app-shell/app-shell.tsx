"use client";

import type { ReactNode } from "react";
import { usePublishAppShellChrome } from "./app-shell-chrome-context";
import type { BreadcrumbItem } from "./breadcrumbs";

// AppShell no longer renders the sidebar/Topbar/main frame itself -- that now lives once in
// the persistent (app) layout (see src/app/(app)/layout.tsx) so it doesn't remount on every
// navigation. Every page still calls AppShell exactly as before (same props); internally it
// just publishes those props (breadcrumbs/userName/userRole/onSignOut) up to the shared
// chrome via context, and renders children directly in place. This kept every existing
// page.tsx, ModulePageShell, and FinancePageShell call site unchanged.
export function AppShell({
  breadcrumbs,
  userName,
  userRole,
  onSignOut,
  children,
}: {
  breadcrumbs: BreadcrumbItem[];
  userName: string;
  userRole?: string;
  onSignOut: () => void;
  children: ReactNode;
}) {
  usePublishAppShellChrome({ breadcrumbs, userName, userRole, onSignOut });
  return <>{children}</>;
}
