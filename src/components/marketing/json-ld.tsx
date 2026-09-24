import { SITE_URL, SITE_NAME } from "@/lib/site";

// Site-wide structured data for the marketing site only (rendered from
// (marketing)/layout.tsx, not the root layout -- this must never appear on
// authenticated app routes). Deliberately conservative: only facts already
// asserted elsewhere on the site (name, URL, logo, what the product is,
// city-level location as shown on /about and in the footer) are included.
// No aggregateRating, no offers/pricing numbers (Phase 7 deliberately
// withholds exact rates), no sameAs social profiles, no street address or
// registration number (not yet provided) -- none of that is claimed here.
// Extend this only when a fact becomes real and public.
export function MarketingJsonLd() {
  const organization = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: SITE_URL,
    logo: `${SITE_URL}/educore-logo-lockup.png`,
    description: "School management platform for Kenyan schools.",
    address: {
      "@type": "PostalAddress",
      addressLocality: "Nairobi",
      addressCountry: "KE",
    },
  };

  // A SoftwareApplication block previously lived here too, but Google's
  // rich-result validation for that type requires either `offers` or
  // `aggregateRating` -- neither of which this site states anywhere
  // (Phase 7 deliberately withholds exact pricing, and there are no real
  // reviews to cite). That gap made ahrefs/Google flag a "rich results
  // validation error" on every marketing page site-wide. Re-add it only
  // once one of those two facts becomes real and public -- see the
  // Organization block above for the same "don't assert what isn't true
  // yet" policy.
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(organization) }}
    />
  );
}
