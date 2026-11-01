import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SCHOOL_CATEGORIES } from "@/lib/marketing/school-categories";
import SchoolsHubPage, { metadata } from "./page";

const unescape = (html: string) => html.replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');

describe("/schools hub page", () => {
  const html = renderToStaticMarkup(<SchoolsHubPage />);
  const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);

  it("has one h1 and a card linking to every category page", () => {
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
    for (const c of SCHOOL_CATEGORIES) {
      expect(hrefs, c.slug).toContain(`/schools/${c.slug}`);
      expect(unescape(html), c.slug).toContain(c.summary);
    }
  });

  it("sends the CTAs to the existing demo form and signup, and only links internally", () => {
    expect(hrefs).toContain("/contact");
    expect(hrefs).toContain("/signup");
    for (const h of hrefs) expect(h, h).toMatch(/^(\/|#)/);
  });

  it("has its own metadata with a canonical and a search-friendly length", () => {
    expect(metadata.alternates?.canonical).toBe("/schools");
    expect(String(metadata.title).length).toBeLessThanOrEqual(65);
    expect(String(metadata.description).length).toBeGreaterThanOrEqual(100);
    expect(String(metadata.description).length).toBeLessThanOrEqual(165);
  });

  it("gives every category a distinct one-line summary", () => {
    const summaries = SCHOOL_CATEGORIES.map((c) => c.summary);
    expect(new Set(summaries).size).toBe(summaries.length);
    expect(summaries.every((s) => s.length > 40 && s.length < 140)).toBe(true);
  });
});
