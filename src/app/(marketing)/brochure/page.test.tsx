import { existsSync, statSync } from "fs";
import path from "path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import BrochurePage, { metadata } from "./page";

describe("brochure landing page", () => {
  const html = renderToStaticMarkup(<BrochurePage />);

  it("links to a PDF that actually exists in public/downloads, so a rename can't break outreach emails", () => {
    expect(html).toContain('href="/downloads/educore-brochure.pdf"');
    const file = path.join(process.cwd(), "public", "downloads", "educore-brochure.pdf");
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).size).toBeGreaterThan(100_000);
  });

  it("is a campaign page: noindex, with a demo and trial path, and no pricing or statistics of its own", () => {
    expect(metadata.robots).toMatchObject({ index: false });
    expect(html).toContain('href="/contact"');
    expect(html).toContain('href="/signup"');
    expect(html).not.toMatch(/KES|\d+\+\s*schools/i);
  });
});
