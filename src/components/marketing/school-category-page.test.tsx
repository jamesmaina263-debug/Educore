import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PUBLISHED_PRICE_KES_PER_STUDENT_TERM } from "@/lib/growth/product-facts";
import { SCHOOL_CATEGORIES } from "@/lib/marketing/school-categories";
import { TRIAL_CTA_LABEL, TRIAL_HREF, TRIAL_TERMS } from "@/lib/marketing/trial";
import { SchoolCategoryPage } from "./school-category-page";

const unescape = (html: string) =>
  html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

function jsonLd(html: string): Array<Record<string, unknown>> {
  return [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((m) => JSON.parse(unescape(m[1])));
}

describe.each(SCHOOL_CATEGORIES)("SchoolCategoryPage: $slug", (category) => {
  const html = renderToStaticMarkup(<SchoolCategoryPage category={category} />);
  const text = unescape(html);

  it("has exactly one h1, with the category headline", () => {
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
    expect(text).toContain(category.h1);
  });

  it("renders every section the brief asks for", () => {
    for (const heading of [
      "The Challenges",
      "How EduCore Helps",
      "The Modules",
      "The Benefits",
      "How It Works",
      "Pricing",
      "Questions",
      "Get Started",
    ]) {
      expect(text, heading).toContain(heading);
    }
    for (const m of category.modules) expect(text, m.title).toContain(m.title);
    for (const s of category.steps) expect(text, s.title).toContain(s.title);
    for (const b of category.benefits) expect(text, b.audience).toContain(b.audience);
  });

  it("sends the demo CTA to the existing contact form and the trial CTA to the existing signup", () => {
    expect(text).toContain("Book a Free Demo");
    expect(text).toContain(TRIAL_CTA_LABEL);
    expect(TRIAL_HREF).toBe("/signup");
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    expect(hrefs.filter((h) => h === "/contact").length).toBeGreaterThanOrEqual(2);
    expect(hrefs.filter((h) => h === TRIAL_HREF).length).toBeGreaterThanOrEqual(2);
  });

  it("only links to internal pages (no new external destinations)", () => {
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    for (const h of hrefs) expect(h, h).toMatch(/^(\/|#)/);
    // No query strings: category context travels via the existing CTA tracker, not new URL params.
    for (const h of hrefs) expect(h, h).not.toContain("?");
  });

  it("reuses the published price and trial wording", () => {
    expect(text).toContain(`KES ${PUBLISHED_PRICE_KES_PER_STUDENT_TERM} per student, per term`);
    expect(text).toContain(TRIAL_TERMS);
  });

  it("emits FAQPage JSON-LD that matches the visible FAQ, and a breadcrumb for this page", () => {
    const blocks = jsonLd(html);
    const faq = blocks.find((b) => b["@type"] === "FAQPage") as { mainEntity: { name: string; acceptedAnswer: { text: string } }[] };
    expect(faq.mainEntity).toHaveLength(category.faqs.length);
    for (const item of faq.mainEntity) {
      expect(text).toContain(item.name);
      expect(text).toContain(item.acceptedAnswer.text);
    }
    const crumbs = blocks.find((b) => b["@type"] === "BreadcrumbList") as { itemListElement: { item: string }[] };
    expect(crumbs.itemListElement.at(-1)?.item).toMatch(new RegExp(`/schools/${category.slug}$`));
  });

  it("links to the other school types", () => {
    for (const slug of category.related) expect(html).toContain(`href="/schools/${slug}"`);
  });

  it("describes the hero preview for assistive tech and marks previews as illustrative", () => {
    expect(text).toContain(category.heroAlt);
    expect(text).toContain("Illustrative preview — not actual account data.");
  });
});
