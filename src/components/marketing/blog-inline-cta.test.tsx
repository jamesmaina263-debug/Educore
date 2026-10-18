import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BlogInlineCta } from "./blog-inline-cta";

// The click tracker in analytics.tsx classifies a CTA purely by href shape (/contact, https://wa.me/),
// so these assertions are what keep inline-CTA clicks showing up in the admin "CTA clicks" table.
describe("BlogInlineCta", () => {
  const html = renderToStaticMarkup(
    <BlogInlineCta headline="Keeping SBA records?" body="Body text." topic="KJSEA and SBA records" />,
  );

  it("links the primary button to /contact", () => {
    expect(html).toContain('href="/contact"');
    expect(html).toContain("See it with your classes");
  });

  it("links WhatsApp to the business number with the topic prefilled", () => {
    expect(html).toContain("https://wa.me/254702904562?text=");
    expect(html).toContain(encodeURIComponent("I read your guide on KJSEA and SBA records"));
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("uses button text distinct from the end-of-post 'Book a Demo'", () => {
    expect(html).not.toContain("Book a Demo");
  });
});
