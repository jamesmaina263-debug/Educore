// GA4's automatic "page changes based on browser history events" fires the instant the URL
// changes. In the Next.js App Router that is before the new page's <title> is in the document, so
// GA4 records a stale (or generic "EduCore") page title for in-app navigations. This tracker sends
// one dataLayer event per client-side navigation *after* the title has caught up; a GTM GA4 Event
// tag turns it into the page_view, and the automatic history-change setting is then switched off
// in GA4 so views aren't counted twice.
//
// The first page of a document load is deliberately NOT reported here -- the Google tag already
// sends that page_view itself, with the right title, on load.
//
// Pure and dependency-injected (no window/document access) so it can be unit tested in node.

export const SPA_PAGE_VIEW_EVENT = "spa_page_view";

export type SpaPageViewEvent = {
  event: typeof SPA_PAGE_VIEW_EVENT;
  page_title: string;
  page_location: string;
  page_path: string;
};

export type PageViewTrackerDeps = {
  getTitle: () => string;
  getLocation: () => string;
  push: (event: SpaPageViewEvent) => void;
  schedule: (fn: () => void, ms: number) => unknown;
  cancel: (handle: unknown) => void;
};

const POLL_MS = 50;
// Give the title up to ~0.8s to change. A page whose title legitimately equals the previous
// page's still gets reported once this elapses.
const MAX_POLLS = 16;

export function createPageViewTracker(deps: PageViewTrackerDeps) {
  let started = false;
  let lastPath: string | null = null;
  let lastTitle = "";
  let pending: unknown = null;

  function onPathname(pathname: string): void {
    if (!started) {
      started = true;
      lastPath = pathname;
      lastTitle = deps.getTitle();
      return;
    }
    if (pathname === lastPath) return;
    lastPath = pathname;

    if (pending !== null) {
      deps.cancel(pending);
      pending = null;
    }

    const attempt = (polls: number): void => {
      const title = deps.getTitle();
      if (title !== lastTitle || polls >= MAX_POLLS) {
        pending = null;
        lastTitle = title;
        deps.push({
          event: SPA_PAGE_VIEW_EVENT,
          page_title: title,
          page_location: deps.getLocation(),
          page_path: pathname,
        });
        return;
      }
      pending = deps.schedule(() => attempt(polls + 1), POLL_MS);
    };
    attempt(0);
  }

  return { onPathname };
}
