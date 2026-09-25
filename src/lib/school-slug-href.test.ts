import { describe, it, expect } from "vitest";
import { withSchoolSlug, stripSchoolSlug, sanitizeSchoolSlug } from "./school-slug-href";
import { APP_ROUTE_SEGMENTS, NEVER_PREFIX, resolveSlugRouting } from "./school-slug-routing";
import { SCHOOL_SLUG_COOKIE } from "./school-slug-cookie";
import { NextRequest } from "next/server";
import { navGroups } from "@/components/app-shell/nav-items";
import { GO_TO_SHORTCUTS } from "./go-to-shortcuts";

const SLUG = "gititu-high-schoool-465f74";

describe("withSchoolSlug", () => {
  it("prefixes staff-app routes", () => {
    expect(withSchoolSlug(SLUG, "/students")).toBe(`/${SLUG}/students`);
    expect(withSchoolSlug(SLUG, "/finance/dashboard")).toBe(`/${SLUG}/finance/dashboard`);
    expect(withSchoolSlug(SLUG, "/students?page=2#top")).toBe(`/${SLUG}/students?page=2#top`);
  });
  it("is a no-op without a slug (today's behaviour)", () => {
    expect(withSchoolSlug(undefined, "/students")).toBe("/students");
  });
  it("never prefixes admin, API, marketing, portal or login routes", () => {
    for (const href of ["/admin", "/admin/schools", "/api/x", "/login", "/portal", "/pricing", "/change-password"]) {
      expect(withSchoolSlug(SLUG, href)).toBe(href);
    }
  });
  it("does not double-prefix and ignores non-absolute or external hrefs", () => {
    expect(withSchoolSlug(SLUG, `/${SLUG}/students`)).toBe(`/${SLUG}/students`);
    expect(withSchoolSlug(SLUG, "https://example.com/students")).toBe("https://example.com/students");
    expect(withSchoolSlug(SLUG, "students")).toBe("students");
    expect(withSchoolSlug(SLUG, "/")).toBe("/");
  });
});

describe("stripSchoolSlug", () => {
  it("removes the slug prefix only when present", () => {
    expect(stripSchoolSlug(SLUG, `/${SLUG}/students/abc`)).toBe("/students/abc");
    expect(stripSchoolSlug(SLUG, `/${SLUG}`)).toBe("/");
    expect(stripSchoolSlug(SLUG, "/students")).toBe("/students");
    expect(stripSchoolSlug(SLUG, `/${SLUG}x/students`)).toBe(`/${SLUG}x/students`);
    expect(stripSchoolSlug(undefined, `/${SLUG}/students`)).toBe(`/${SLUG}/students`);
  });
});

describe("sanitizeSchoolSlug", () => {
  it("accepts real slugs and rejects anything odd", () => {
    expect(sanitizeSchoolSlug("little-beginners-school-29fa4a")).toBe("little-beginners-school-29fa4a");
    for (const bad of ["", undefined, null, "Has Space", "../etc", "a/b", "UPPER", "-lead", "x".repeat(200)]) {
      expect(sanitizeSchoolSlug(bad as string | undefined)).toBeUndefined();
    }
  });
});

// The whole point of the change: a link this helper produces must be a request the proxy lets
// straight through (a rewrite), never one it 307-redirects. Checked against the real proxy logic
// for every nav item and go-to shortcut, so a future route can't silently reintroduce the hop.
describe("slugged links skip the proxy redirect", () => {
  const hrefs = [
    ...navGroups.flatMap((g) => g.items.flatMap((i) => [i.href, ...(i.children?.map((c) => c.href) ?? [])])),
    ...GO_TO_SHORTCUTS.map((s) => s.href),
  ];
  const req = (pathname: string, cookie?: string) => {
    const r = new NextRequest(new URL(pathname, "https://educoreafrica.com"));
    if (cookie) r.cookies.set(SCHOOL_SLUG_COOKIE, cookie);
    return r;
  };

  it("bare links DO redirect (documents the bug), slugged links do not", () => {
    for (const href of hrefs) {
      const first = href.split("/").filter(Boolean)[0];
      if (!APP_ROUTE_SEGMENTS.has(first) || NEVER_PREFIX.has(first)) continue;
      expect(resolveSlugRouting(req(href, SLUG), true).type, `bare ${href}`).toBe("redirect");
      const slugged = withSchoolSlug(SLUG, href);
      expect(slugged, href).toBe(`/${SLUG}${href}`);
      expect(resolveSlugRouting(req(slugged, SLUG), true).type, `slugged ${slugged}`).toBe("rewrite");
    }
  });
});
