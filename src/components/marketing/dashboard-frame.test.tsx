import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { navGroups } from "@/components/app-shell/nav-items";
import { DashboardFrame } from "./dashboard-frame";

describe("DashboardFrame", () => {
  const html = renderToStaticMarkup(<DashboardFrame />);
  const decode = (s: string) => s.replace(/&amp;/g, "&");
  const text = decode(html);

  it("keeps the illustrative school name", () => {
    expect(text).toContain("Northgate Academy");
  });

  it("shows every top-level module from the real app navigation", () => {
    for (const group of navGroups) {
      for (const item of group.items) {
        if (group.label === "Finance") continue; // rendered via its children
        expect(text, `missing module: ${item.label}`).toContain(item.label);
      }
    }
  });

  it("shows every Finance sub-page from the real app navigation", () => {
    const finance = navGroups.find((g) => g.label === "Finance")!.items[0];
    for (const child of finance.children ?? []) {
      expect(text, `missing finance page: ${child.label}`).toContain(child.label);
    }
  });

  it("uses the headline figures and a current term", () => {
    for (const figure of ["812", "96.2%", "23", "KES 4.1M", "KES 620K", "Term 3, 2026"]) {
      expect(text).toContain(figure);
    }
  });
});
