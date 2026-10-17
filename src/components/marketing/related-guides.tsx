import Link from "next/link";

import { Eyebrow } from "@/components/marketing/eyebrow";
import { Reveal } from "@/components/marketing/reveal";
import { Section } from "@/components/marketing/section";
import { BLOG_POSTS } from "@/lib/blog-posts";
import { GUIDES_FOR_PAGE, RELATED_GUIDES } from "@/lib/blog-related";

// "Keep reading" block of contextual internal links. Pass `slug` on a blog
// post (links come from RELATED_GUIDES) or `page` on a landing page (links
// come from GUIDES_FOR_PAGE). Both maps live in src/lib/blog-related.ts.
// Renders nothing if no valid guides resolve, so a bad slug can never
// produce a broken link.
export function RelatedGuides({
  slug,
  page,
  heading,
}: {
  slug?: string;
  page?: string;
  heading?: string;
}) {
  const wanted = slug
    ? RELATED_GUIDES[slug] ?? []
    : page
      ? GUIDES_FOR_PAGE[page] ?? []
      : [];
  const posts = wanted
    .map((s) => BLOG_POSTS.find((p) => p.slug === s))
    .filter((p): p is (typeof BLOG_POSTS)[number] => Boolean(p));
  if (posts.length === 0) return null;

  return (
    <Section tone="canvas" className="border-t border-marketing-navy-900/10 py-14 sm:py-16">
      <Reveal className="mx-auto max-w-3xl">
        <Eyebrow>Keep Reading</Eyebrow>
        <h2 className="mt-3 text-xl font-semibold tracking-tight text-marketing-navy-950 sm:text-2xl">
          {heading ?? "Related guides"}
        </h2>
        <ul className="mt-6 flex flex-col gap-5">
          {posts.map((p) => (
            <li key={p.slug}>
              <Link
                href={`/blog/${p.slug}`}
                className="text-base font-semibold text-marketing-navy-950 underline underline-offset-4"
              >
                {p.title.replace(/ — EduCore$/, "")}
              </Link>
              <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-marketing-navy-900/70">
                {p.description}
              </p>
            </li>
          ))}
        </ul>
      </Reveal>
    </Section>
  );
}
