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

  const softwareApplication = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    applicationCategory: "EducationalApplication",
    operatingSystem: "Web",
    description: "School management platform for Kenyan schools.",
    url: SITE_URL,
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organization) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareApplication) }}
      />
    </>
  );
}
