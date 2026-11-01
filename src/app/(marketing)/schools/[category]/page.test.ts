import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import SchoolCategoryRoute, { dynamicParams, generateMetadata, generateStaticParams } from "./page";

describe("/schools/[category] route", () => {
  it("pre-renders exactly the five category pages and 404s anything else", () => {
    expect(generateStaticParams().map((p) => p.category)).toEqual([
      "nursery-kindergarten",
      "primary-schools",
      "junior-schools",
      "secondary-schools",
      "integrated-schools",
    ]);
    expect(dynamicParams).toBe(false);
  });

  it("gives every page a unique title, description and canonical URL", async () => {
    const seen = { titles: new Set<string>(), descriptions: new Set<string>(), canonicals: new Set<string>() };
    for (const { category } of generateStaticParams()) {
      const md = await generateMetadata({ params: Promise.resolve({ category }) });
      expect(md.alternates?.canonical).toBe(`/schools/${category}`);
      expect((md.openGraph as { url?: string })?.url).toBe(`/schools/${category}`);
      expect((md.twitter as { card?: string })?.card).toBe("summary_large_image");
      seen.titles.add(String(md.title));
      seen.descriptions.add(String(md.description));
      seen.canonicals.add(String(md.alternates?.canonical));
    }
    expect(seen.titles.size).toBe(5);
    expect(seen.descriptions.size).toBe(5);
    expect(seen.canonicals.size).toBe(5);
  });

  it("returns no metadata and not-found for an unknown category", async () => {
    expect(await generateMetadata({ params: Promise.resolve({ category: "nope" }) })).toEqual({});
    await expect(SchoolCategoryRoute({ params: Promise.resolve({ category: "nope" }) })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
