import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// usePathname is the only router hook SidebarNav needs; everything else (Link) renders as a
// plain <a> during SSR. Mocked per test so we can simulate the router reporting either the
// visible (slugged) or the rewritten (bare) pathname.
let mockPathname = "/";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: () => {} }),
}));

import { SidebarNav } from "./sidebar-nav";
import { SchoolSlugProvider } from "./school-slug-context";

const SLUG = "gititu-high-schoool-465f74";

function render(slug: string | undefined) {
  return renderToStaticMarkup(
    <SchoolSlugProvider slug={slug}>
      <SidebarNav />
    </SchoolSlugProvider>,
  );
}

function hrefs(html: string) {
  return [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
}

// "bg-sidebar-primary/10" is the active-row class in sidebar-nav.tsx (React renders class before href).
function activeHrefs(html: string) {
  return [...html.matchAll(/<a class="[^"]*bg-sidebar-primary\/10[^"]*" href="([^"]+)"/g)].map((m) => m[1]);
}

describe("SidebarNav slug-aware links", () => {
  beforeEach(() => {
    mockPathname = "/";
  });

  it("with a slug, every staff-app link is slugged so the proxy never has to 307", () => {
    const list = hrefs(render(SLUG));
    expect(list.length).toBeGreaterThan(10);
    for (const h of list) expect(h.startsWith(`/${SLUG}/`), h).toBe(true);
    expect(list).toContain(`/${SLUG}/students`);
  });

  it("without a slug, links are exactly the bare paths they were before", () => {
    const list = hrefs(render(undefined));
    expect(list).toContain("/students");
    expect(list.some((h) => h.startsWith(`/${SLUG}`))).toBe(false);
  });

  it("highlights the active item when the router reports the slugged pathname", () => {
    mockPathname = `/${SLUG}/students`;
    expect(activeHrefs(render(SLUG))).toEqual([`/${SLUG}/students`]);
  });

  it("highlights the active item when the router reports the rewritten (bare) pathname", () => {
    mockPathname = "/students";
    expect(activeHrefs(render(SLUG))).toEqual([`/${SLUG}/students`]);
  });

  it("no-slug behaviour is unchanged for active matching", () => {
    mockPathname = "/students/abc-123";
    expect(activeHrefs(render(undefined))).toEqual(["/students"]);
  });
});
