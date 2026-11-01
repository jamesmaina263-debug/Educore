import { describe, expect, it } from "vitest";
import sitemap from "@/app/sitemap";
import { isMarketingPath } from "@/lib/marketing-routes";
import { NEVER_PREFIX } from "@/lib/school-slug-routing";
import { SCHOOL_CATEGORIES, getSchoolCategory } from "./school-categories";

const REQUIRED_SLUGS = [
  "nursery-kindergarten",
  "primary-schools",
  "junior-schools",
  "secondary-schools",
  "integrated-schools",
];

const textOf = (c: unknown) => JSON.stringify(c);

describe("school category landing page config", () => {
  it("defines exactly the five required routes", () => {
    expect(SCHOOL_CATEGORIES.map((c) => c.slug)).toEqual(REQUIRED_SLUGS);
    for (const slug of REQUIRED_SLUGS) expect(getSchoolCategory(slug)?.slug).toBe(slug);
    expect(getSchoolCategory("not-a-category")).toBeUndefined();
  });

  it("uses the agreed core message for each category", () => {
    const core = Object.fromEntries(SCHOOL_CATEGORIES.map((c) => [c.slug, c.coreMessage]));
    expect(core).toEqual({
      "nursery-kindergarten": "Spend less time managing paperwork and more time nurturing young learners.",
      "primary-schools": "Bring your school's academic and administrative operations together in one organised system.",
      "junior-schools": "Make learner assessment, academic reporting and school administration easier with EduCore.",
      "secondary-schools": "Manage academics, finances and school operations with greater visibility and control.",
      "integrated-schools": "One connected platform for managing your school's operations across different educational levels.",
    });
  });

  it("gives every page its own metadata and copy, not five copies of one page", () => {
    const unique = (values: string[]) => new Set(values).size === values.length;
    expect(unique(SCHOOL_CATEGORIES.map((c) => c.metaTitle))).toBe(true);
    expect(unique(SCHOOL_CATEGORIES.map((c) => c.metaDescription))).toBe(true);
    expect(unique(SCHOOL_CATEGORIES.map((c) => c.h1))).toBe(true);
    expect(unique(SCHOOL_CATEGORIES.map((c) => c.heroLead))).toBe(true);
    expect(unique(SCHOOL_CATEGORIES.flatMap((c) => c.challenges.map((x) => x.title)))).toBe(true);
    expect(unique(SCHOOL_CATEGORIES.flatMap((c) => c.modules.map((m) => `${c.slug}:${m.title}`)))).toBe(true);
  });

  it("keeps titles and descriptions within search-result limits", () => {
    for (const c of SCHOOL_CATEGORIES) {
      expect(c.metaTitle.length, c.slug).toBeLessThanOrEqual(65);
      expect(c.metaDescription.length, c.slug).toBeGreaterThanOrEqual(100);
      expect(c.metaDescription.length, c.slug).toBeLessThanOrEqual(165);
    }
  });

  it("has the content every section needs", () => {
    for (const c of SCHOOL_CATEGORIES) {
      expect(c.challenges.length, c.slug).toBeGreaterThanOrEqual(3);
      expect(c.modules.length, c.slug).toBeGreaterThanOrEqual(5);
      expect(c.benefits.length, c.slug).toBe(4);
      expect(c.steps.length, c.slug).toBe(4);
      expect(c.faqs.length, c.slug).toBeGreaterThanOrEqual(5);
      for (const f of c.faqs) {
        expect(f.q.trim()).not.toBe("");
        expect(f.a.trim()).not.toBe("");
      }
      for (const m of c.modules) expect(m.capabilities.length, `${c.slug}/${m.title}`).toBeGreaterThan(0);
    }
  });

  it("links only to categories that exist, never to itself", () => {
    for (const c of SCHOOL_CATEGORIES) {
      expect(c.related).not.toContain(c.slug);
      for (const slug of c.related) expect(getSchoolCategory(slug), `${c.slug} -> ${slug}`).toBeDefined();
    }
  });

  it("makes no claims the product can't back (see src/lib/growth/product-facts.ts rules)", () => {
    for (const c of SCHOOL_CATEGORIES) {
      const text = textOf(c);
      // No regulator approval / endorsement language, no social proof, no figures, no customer names.
      expect(text, c.slug).not.toMatch(/\b(certified|accredited|endorsed|official)\b/i);
      expect(text, c.slug).not.toMatch(/(approved|recogni[sz]ed|licensed|authori[sz]ed) by (KICD|KNEC|the Ministry|the government|MoE)/i);
      expect(text, c.slug).not.toMatch(/testimonial|\d+\s?%|\baward/i);
      expect(text, c.slug).not.toMatch(/Gititu|Little Beginners|Northgate/i);
      // Result locking was not verified (marks go submitted -> approved only).
      expect(text, c.slug).not.toMatch(/result lock|locked results|locks? (the )?(marks|results)/i);
    }
  });

  it("mentions KNEC only to say EduCore doesn't claim automatic submission", () => {
    for (const c of SCHOOL_CATEGORIES) {
      const text = textOf(c);
      if (c.slug !== "junior-schools") {
        expect(text, c.slug).not.toMatch(/KNEC/);
        continue;
      }
      const mentions = c.faqs.filter((f) => /KNEC/.test(f.q + f.a));
      expect(mentions).toHaveLength(1);
      expect(mentions[0].a).toMatch(/doesn't advertise automatic submission to KNEC/);
      expect(text).not.toMatch(/KNEC[- ](integrat|sync|submission is automatic)/i);
    }
  });

  it("keeps nursery copy to what the kindergarten guidance allows (no exams, marks, grades or rankings)", () => {
    const nursery = textOf(getSchoolCategory("nursery-kindergarten"));
    expect(nursery).not.toMatch(/\b(exams?|marks?|grades?|grading|rankings?|KCPE|KCSE|KJSEA|merit)\b/i);
    expect(nursery).not.toMatch(/designed (specifically )?for pre-?primary/i);
  });

  it("states plan-dependent modules as plan-dependent", () => {
    for (const c of SCHOOL_CATEGORIES) {
      for (const m of c.modules.filter((m) => /boarding/i.test(m.title))) {
        expect(m.description + m.capabilities.join(" "), c.slug).toMatch(/Growth plan/i);
      }
    }
  });
});

describe("school category routing and discovery", () => {
  it("is allowed through the school-slug rewrite and counts as a marketing path", () => {
    expect(NEVER_PREFIX.has("schools")).toBe(true);
    expect(isMarketingPath("/schools/primary-schools")).toBe(true);
  });

  it("lists every category in the sitemap with a real lastmod", () => {
    const entries = sitemap();
    for (const slug of REQUIRED_SLUGS) {
      const entry = entries.find((e) => e.url.endsWith(`/schools/${slug}`));
      expect(entry, slug).toBeDefined();
      expect(entry?.lastModified, slug).toBeTruthy();
    }
  });
});
