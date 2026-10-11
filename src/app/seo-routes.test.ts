import { describe, expect, it } from "vitest";
import sitemap from "./sitemap";
import robots from "./robots";
import { GET as llms } from "./llms.txt/route";
import { PAGE_LAST_MODIFIED } from "@/lib/seo-dates";
import { BLOG_POSTS } from "@/lib/blog-posts";

describe("sitemap", () => {
  it("never uses a rolling 'now' lastModified", () => {
    const a = JSON.stringify(sitemap());
    const b = JSON.stringify(sitemap());
    expect(a).toBe(b);
    for (const entry of sitemap()) {
      expect(entry.lastModified, entry.url).toBeTruthy();
      expect(typeof entry.lastModified).toBe("string");
      expect(String(entry.lastModified)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("has a date for every static route and no future dates", () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const [path, date] of Object.entries(PAGE_LAST_MODIFIED)) {
      expect(date <= today, `${path} dated in the future`).toBe(true);
    }
    expect(Object.keys(PAGE_LAST_MODIFIED)).toContain("/pricing");
  });
});

describe("robots", () => {
  it("repeats the authenticated disallow list for the named AI crawlers", () => {
    const rules = robots().rules as {
      userAgent: string | string[];
      disallow?: string[];
    }[];
    const star = rules.find((r) => r.userAgent === "*")!;
    const ai = rules.find((r) => Array.isArray(r.userAgent))!;
    expect(ai.userAgent).toContain("GPTBot");
    expect(ai.userAgent).toContain("ClaudeBot");
    // A named group overrides `*`, so it must not lose any disallow entry.
    expect(ai.disallow).toEqual(star.disallow);
    expect(ai.disallow).toContain("/dashboard");
  });
});

describe("llms.txt", () => {
  it("serves text/plain and lists every blog post", async () => {
    const res = llms();
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    const body = await res.text();
    expect(body.startsWith("# EduCore")).toBe(true);
    for (const post of BLOG_POSTS) expect(body).toContain(`/blog/${post.slug}`);
    expect(body).toContain("KES 100");
  });
});
