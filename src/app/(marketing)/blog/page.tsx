import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Eyebrow } from "@/components/marketing/eyebrow";
import { Section } from "@/components/marketing/section";
import { Reveal } from "@/components/marketing/reveal";
import { BreadcrumbJsonLd, HOME_CRUMB } from "@/components/marketing/breadcrumb-json-ld";
import { BLOG_POSTS } from "@/lib/blog-posts";

const TITLE = "Blog — EduCore Kenya";
const DESCRIPTION =
  "Guides and practical advice on running a school in Kenya — fee collection, CBC grading, admissions, and choosing school management software.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/blog" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/blog" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

// Sort newest-first so a fresh post always lands at the top without
// needing the registry itself kept in date order.
const POSTS_NEWEST_FIRST = [...BLOG_POSTS].sort((a, b) => (a.publishedOn < b.publishedOn ? 1 : -1));

export default function BlogIndexPage() {
  return (
    <>
      <BreadcrumbJsonLd items={[HOME_CRUMB, { name: "Blog", path: "/blog" }]} />
      {/* 1 — Hero */}
      <Section tone="navy" className="pb-14 pt-20 sm:pb-16 sm:pt-28">
        <Eyebrow tone="dark">Blog</Eyebrow>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          Guides for running a school in Kenya
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/70">
          Practical advice on fees, admissions, CBC grading, and choosing the
          right systems — written for school owners, principals, and
          administrators, not software buyers in the abstract.
        </p>
      </Section>

      {/* 2 — Post list */}
      <Section tone="canvas">
        {POSTS_NEWEST_FIRST.length === 0 ? (
          <p className="text-marketing-navy-950/70">No posts yet — check back soon.</p>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2">
            {POSTS_NEWEST_FIRST.map((post) => (
              <Reveal key={post.slug}>
                <Link
                  href={`/blog/${post.slug}`}
                  className="group flex h-full flex-col rounded-xl border border-marketing-navy-900/10 bg-white p-6 shadow-sm transition-colors hover:border-marketing-gold-500/50"
                >
                  <time
                    dateTime={post.publishedOn}
                    className="font-mono text-xs uppercase tracking-[0.14em] text-marketing-navy-950/50"
                  >
                    {new Date(`${post.publishedOn}T00:00:00Z`).toLocaleDateString("en-KE", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                      timeZone: "UTC",
                    })}
                  </time>
                  <h2 className="mt-3 text-xl font-semibold text-marketing-navy-950">{post.title}</h2>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-marketing-navy-950/70">
                    {post.description}
                  </p>
                  <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-marketing-gold-600 group-hover:gap-2.5 transition-all">
                    Read guide
                    <ArrowRight className="h-4 w-4" />
                  </span>
                </Link>
              </Reveal>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}
