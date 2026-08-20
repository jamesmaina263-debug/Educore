import { describe, it, expect } from "vitest";
import { APP_ROUTE_SEGMENTS, NEVER_PREFIX } from "./school-slug-routing";
import { navGroups } from "@/components/app-shell/nav-items";

// Regression test for the exact bug that broke /parents: a new top-level nav
// module (real route under src/app/(app)) whose first path segment was never
// added to APP_ROUTE_SEGMENTS silently gets treated by resolveSlugRouting as
// an unrecognized "school slug" and rewritten away to /dashboard -- the page
// itself works fine, but the sidebar link (and every other way of reaching
// it) does nothing visible. This makes that class of bug fail CI instead of
// being discovered by a user clicking a dead link in production.
describe("APP_ROUTE_SEGMENTS stays in sync with the real nav", () => {
  it("includes the first path segment of every top-level nav item", () => {
    const missing: string[] = [];
    for (const group of navGroups) {
      for (const item of group.items) {
        const first = item.href.split("/").filter(Boolean)[0];
        if (!first) continue;
        if (!APP_ROUTE_SEGMENTS.has(first) && !NEVER_PREFIX.has(first)) {
          missing.push(`${item.label} -> /${first}`);
        }
      }
    }
    expect(missing, `Top-level nav routes missing from APP_ROUTE_SEGMENTS/NEVER_PREFIX: ${missing.join(", ")}`).toEqual(
      [],
    );
  });
});
