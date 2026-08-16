"use client";

import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from "react";
import type { BreadcrumbItem } from "./breadcrumbs";

export interface AppShellChromeState {
  breadcrumbs: BreadcrumbItem[];
  userName: string;
  userRole?: string;
  onSignOut: () => void;
}

interface AppShellChromeContextValue {
  chrome: AppShellChromeState | null;
  setChrome: (chrome: AppShellChromeState) => void;
}

const AppShellChromeContext = createContext<AppShellChromeContextValue | null>(null);

// Lives once in the persistent (app) layout, wrapping the sidebar/Topbar/main that never
// remount across navigations. Individual pages (via AppShell below) push their own
// breadcrumbs/user info up into this on every render instead of rendering their own copy of
// the chrome -- this is what stops the sidebar from remounting (and losing scroll position /
// snapping back to the top of the list) on every navigation between pages.
export function AppShellChromeProvider({ children }: { children: ReactNode }) {
  const [chrome, setChrome] = useState<AppShellChromeState | null>(null);
  return (
    <AppShellChromeContext.Provider value={{ chrome, setChrome }}>
      {children}
    </AppShellChromeContext.Provider>
  );
}

export function useAppShellChrome() {
  const ctx = useContext(AppShellChromeContext);
  if (!ctx) throw new Error("useAppShellChrome must be used within AppShellChromeProvider");
  return ctx;
}

// Called by AppShell on every page. useLayoutEffect (not useEffect) so the Topbar's
// breadcrumbs/user info update before the browser paints the new page -- no visible flash of
// stale or empty chrome while navigating.
export function usePublishAppShellChrome(state: AppShellChromeState) {
  const { setChrome } = useAppShellChrome();
  useLayoutEffect(() => {
    setChrome(state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.userName, state.userRole, JSON.stringify(state.breadcrumbs)]);
}
