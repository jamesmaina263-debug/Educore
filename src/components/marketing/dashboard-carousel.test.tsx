import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { navGroups } from "@/components/app-shell/nav-items";
import { DashboardCarousel } from "./dashboard-carousel";

describe("DashboardCarousel", () => {
  const html = renderToStaticMarkup(<DashboardCarousel />).replace(/&amp;/g, "&");

  it("keeps the dashboard as the first slide", () => {
    expect(html).toContain("Northgate Academy");
    expect(html).toContain("Fee collection vs. invoiced");
    expect(html.indexOf("Fee collection vs. invoiced")).toBeLessThan(html.indexOf("All modules"));
  });

  it("adds an All modules slide listing every module from the real navigation", () => {
    const slide = html.slice(html.indexOf("app.educore.io/modules"));
    for (const group of navGroups) {
      for (const item of group.items) {
        expect(slide, `missing module: ${item.label}`).toContain(item.label);
      }
    }
  });

  it("swipes with native scroll-snap, and hides the extra slide and tabs on desktop", () => {
    expect(html).toContain("snap-x");
    expect(html).toContain("snap-mandatory");
    expect(html).toMatch(/snap-center lg:hidden/);
    expect(html).toMatch(/role="tablist"[^>]*/);
    expect(html).toMatch(/mt-4 flex[^"]*lg:hidden/);
  });

  it("exposes both screens as labelled tabs", () => {
    expect(html).toContain(">Dashboard</button>");
    expect(html).toContain(">All modules</button>");
  });
});
