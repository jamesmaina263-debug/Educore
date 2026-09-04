import { SITE_URL, SITE_NAME } from "@/lib/site";

type ArticleJsonLdProps = {
  headline: string;
  description: string;
  /** Path relative to SITE_URL, e.g. "/blog/best-school-management-system-kenya".
   *  Must match this page's own `alternates.canonical`. */
  path: string;
  /** ISO date (YYYY-MM-DD) the post actually went live -- must match its
   *  entry in src/lib/blog-posts.ts, not a guess. */
  datePublished: string;
  /** ISO date (YYYY-MM-DD) of the most recent substantive edit. Defaults
   *  to datePublished when the post hasn't been revised since. */
  dateModified?: string;
};

// Per-post Article structured data, rendered by each blog post page itself
// (same pattern as BreadcrumbJsonLd) since headline/description/dates
// differ per post. Deliberately reuses the same logo image and Organization
// facts already asserted in MarketingJsonLd -- no invented author bio, no
// separate per-post image asset (none exists; the shared og-image already
// covers social previews).
export function ArticleJsonLd({
  headline,
  description,
  path,
  datePublished,
  dateModified,
}: ArticleJsonLdProps) {
  const article = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline,
    description,
    image: `${SITE_URL}/educore-logo-lockup.png`,
    datePublished,
    dateModified: dateModified ?? datePublished,
    author: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      logo: { "@type": "ImageObject", url: `${SITE_URL}/educore-logo-lockup.png` },
    },
    mainEntityOfPage: { "@type": "WebPage", "@id": `${SITE_URL}${path}` },
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(article) }}
    />
  );
}
