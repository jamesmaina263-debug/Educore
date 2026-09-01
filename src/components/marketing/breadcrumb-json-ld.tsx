import { SITE_URL, SITE_NAME } from "@/lib/site";

type Crumb = {
  /** Label as it should read in search results -- keep this short, it's
   *  what Google renders in place of the URL beneath the title/snippet. */
  name: string;
  /** Path relative to SITE_URL, e.g. "/cbc-school-management". Must match
   *  this page's own `alternates.canonical` so the trail and the page
   *  agree on the URL. */
  path: string;
};

// Per-page BreadcrumbList structured data. Rendered by each marketing page
// itself (not the shared layout, unlike MarketingJsonLd in json-ld.tsx)
// because the trail is different on every page. Always start the `items`
// array with Home ({ name: SITE_NAME, path: "/" }) -- Google's own
// examples do this, and omitting it is a common mistake that makes single
// -level trails pointless. The homepage itself should not render this
// component at all: a one-item trail ("Home") has nothing to show.
export function BreadcrumbJsonLd({ items }: { items: Crumb[] }) {
  const breadcrumbList = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: `${SITE_URL}${item.path}`,
    })),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbList) }}
    />
  );
}

export const HOME_CRUMB: Crumb = { name: SITE_NAME, path: "/" };
