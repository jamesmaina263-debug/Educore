import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { navGroups } from "@/components/app-shell/nav-items";
import { DashboardFrame } from "./dashboard-frame";

describe("DashboardFrame", () => {
  const text = renderToStaticMarkup(<DashboardFrame />).replace(/&amp;/g, "&");

  it("keeps the illustrative school name", () => {
    expect(text).toContain("Northgate Academy");
  });

  it("shows every module from the real app navigation", () => {
    for (const group of navGroups) {
      expect(text, `missing group: ${group.label}`).toContain(group.label);
      for (const item of group.items) {
        expect(text, `missing module: ${item.label}`).toContain(item.label);
      }
    }
  });

  it("mirrors the real Dashboard page sections", () => {
    for (const section of [
      "Record payment",
      "Enrolled students",
      "Fees collected (term)",
      "Attendance today",
      "Outstanding balance",
      "Operations",
      "Fee collection vs. invoiced",
      "Attendance rate by class",
      "Enrollment trend",
      "Requires your attention",
      "Latest invoices",
    ]) {
      expect(text, `missing section: ${section}`).toContain(section);
    }
  });

  it("uses the headline figures and a current term", () => {
    for (const figure of ["812", "96.2%", "KES 4,100,000", "KES 620,000", "Term 3, 2026"]) {
      expect(text).toContain(figure);
    }
  });
});
