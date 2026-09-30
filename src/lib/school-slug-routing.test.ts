import { describe, it, expect } from "vitest";
import { readdirSync } from "fs";
import path from "path";
import { NextRequest } from "next/server";
import { APP_ROUTE_SEGMENTS, NEVER_PREFIX, resolveSlugRouting } from "./school-slug-routing";
import { SCHOOL_SLUG_COOKIE } from "./school-slug-cookie";
import { navGroups } from "@/components/app-shell/nav-items";

function makeRequest(pathname: string, slugCookie?: string) {
  const request = new NextRequest(new URL(pathname, "https://educoreafrica.com"));
  if (slugCookie) request.cookies.set(SCHOOL_SLUG_COOKIE, slugCookie);
  return request;
}

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

// Regression test for the sibling bug found in /student-performance-appraisal
// and /teacher-performance-management: a new top-level page added under
// src/app/(marketing) whose folder name was never added to NEVER_PREFIX gets
// silently treated as a school slug and rewritten away, same failure mode as
// the APP_ROUTE_SEGMENTS check above but for marketing pages instead of app
// nav items. This walks the real (marketing) route-group folder so a future
// page added there fails CI instead of shipping unreachable.
describe("NEVER_PREFIX stays in sync with the real (marketing) pages", () => {
  it("includes every top-level page folder under src/app/(marketing)", () => {
    const marketingDir = path.join(import.meta.dirname, "..", "app", "(marketing)");
    const entries = readdirSync(marketingDir, { withFileTypes: true });
    const missing: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue; // skip layout.tsx, page.tsx, opengraph-image.tsx, etc.
      if (!NEVER_PREFIX.has(entry.name)) missing.push(entry.name);
    }
    expect(missing, `Marketing page folders missing from NEVER_PREFIX: ${missing.join(", ")}`).toEqual([]);
  });
});

// Regression coverage for the bare-single-segment 404 fix: a genuinely
// unknown URL like "/nonexistent-test-page-qa" used to silently rewrite to
// /dashboard and, unauthenticated, land the visitor on a bare unbranded
// /login instead of the site's branded not-found page. Every other shape
// (marketing routes, known app routes, slug + real subpath, slug + fake
// subpath) must resolve exactly as before.
describe("resolveSlugRouting", () => {
  it("never intercepts known marketing routes, authenticated or not", () => {
    for (const segment of NEVER_PREFIX) {
      const unauth = resolveSlugRouting(makeRequest(`/${segment}`), false);
      const auth = resolveSlugRouting(makeRequest(`/${segment}`), true);
      expect(unauth).toEqual({ type: "next" });
      expect(auth).toEqual({ type: "next" });
    }
  });

  it("leaves a bare known app route alone when there's no slug cookie", () => {
    const routing = resolveSlugRouting(makeRequest("/dashboard"), true);
    expect(routing).toEqual({ type: "next" });
  });

  it("redirects a bare known app route to its slug-prefixed URL when a slug cookie is present", () => {
    const routing = resolveSlugRouting(makeRequest("/dashboard", "gititu-high-school"), true);
    expect(routing.type).toBe("redirect");
    if (routing.type === "redirect") {
      expect(routing.url.pathname).toBe("/gititu-high-school/dashboard");
    }
  });

  it("still rewrites a real school-slug URL with a real subpath (authenticated or not)", () => {
    const unauth = resolveSlugRouting(makeRequest("/gititu-high-school/admissions"), false);
    const auth = resolveSlugRouting(makeRequest("/gititu-high-school/admissions"), true);
    expect(unauth).toEqual({ type: "rewrite", url: expect.objectContaining({ pathname: "/admissions" }) });
    expect(auth).toEqual({ type: "rewrite", url: expect.objectContaining({ pathname: "/admissions" }) });
  });

  it("still sends a bare unrecognized single segment to /dashboard when authenticated (unchanged)", () => {
    const routing = resolveSlugRouting(makeRequest("/gititu-high-school"), true);
    expect(routing).toEqual({ type: "rewrite", url: expect.objectContaining({ pathname: "/dashboard" }) });
  });

  it("does NOT rewrite a bare unrecognized single segment to /dashboard when unauthenticated (the fix)", () => {
    const routing = resolveSlugRouting(makeRequest("/nonexistent-test-page-qa"), false);
    expect(routing).toEqual({ type: "next" });
  });

  it("does NOT rewrite a bare, genuinely valid-looking slug to /dashboard when unauthenticated either -- this layer never validates slugs either way", () => {
    const routing = resolveSlugRouting(makeRequest("/gititu-high-school"), false);
    expect(routing).toEqual({ type: "next" });
  });

  it("still lets an unknown slug + fake subpath fall through to rest-of-path (existing 404 behavior, unchanged)", () => {
    const routing = resolveSlugRouting(makeRequest("/nonexistent-test-page-qa/also-fake"), false);
    expect(routing).toEqual({ type: "rewrite", url: expect.objectContaining({ pathname: "/also-fake" }) });
  });
});
