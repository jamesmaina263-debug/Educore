import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { BLOG_POSTS } from "./blog-posts";
import { GUIDES_FOR_PAGE, RELATED_GUIDES } from "./blog-related";

const SLUGS = BLOG_POSTS.map((p) => p.slug);

describe("RELATED_GUIDES", () => {
  it("covers every blog post, with 2-3 real, non-self related guides", () => {
    for (const slug of SLUGS) {
      const related = RELATED_GUIDES[slug];
      expect(related, `no related guides for ${slug}`).toBeDefined();
      expect(related.length, slug).toBeGreaterThanOrEqual(2);
      expect(related.length, slug).toBeLessThanOrEqual(3);
      expect(new Set(related).size, `${slug} has duplicate related slugs`).toBe(related.length);
      for (const r of related) {
        expect(SLUGS, `${slug} -> unknown post ${r}`).toContain(r);
        expect(r, `${slug} links to itself`).not.toBe(slug);
      }
    }
  });

  it("has no keys for posts that don't exist", () => {
    for (const key of Object.keys(RELATED_GUIDES)) expect(SLUGS).toContain(key);
  });

  it("leaves no orphan: every post is linked from at least one other post", () => {
    const linked = new Set(Object.values(RELATED_GUIDES).flat());
    for (const slug of SLUGS) expect(linked.has(slug), `${slug} has no inbound related link`).toBe(true);
  });
});

describe("GUIDES_FOR_PAGE", () => {
  it("points real landing pages at real posts", () => {
    for (const [path, guides] of Object.entries(GUIDES_FOR_PAGE)) {
      expect(existsSync(`src/app/(marketing)${path}/page.tsx`), `${path} is not a page`).toBe(true);
      expect(guides.length, path).toBeGreaterThanOrEqual(1);
      for (const g of guides) expect(SLUGS, `${path} -> unknown post ${g}`).toContain(g);
    }
  });
});
