import { SITE_URL, SITE_NAME, SOCIAL_PROFILES } from "@/lib/site";

// Site-wide structured data for the marketing site only (rendered from
// (marketing)/layout.tsx, not the root layout -- this must never appear on
// authenticated app routes). Deliberately conservative: only facts already
// asserted elsewhere on the site (name, URL, logo, what the product is,
// city-level location as shown on /about and in the footer, the published
// pricing on /pricing, and the live social profiles in SOCIAL_PROFILES) are
// included. No aggregateRating (there are no real reviews to cite), no
// street address or registration number (not yet provided) -- none of that
// is claimed here. Extend this only when a fact becomes real and public.
export function buildOrganizationJsonLd() {
  return {
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
    // EduCore sells to Kenyan schools only (current scope).
    areaServed: { "@type": "Country", name: "Kenya" },
    sameAs: SOCIAL_PROFILES,
  };
}

// SoftwareApplication was removed earlier because Google's rich-result
// validation requires `offers` or `aggregateRating` and the site stated
// neither. Pricing is now public (/pricing: a flat KES 100 per student, per
// term across Starter/Growth/Enterprise, published as "starting at"), so
// `offers` is back. Keep the figure in sync with PRICE_LINE on
// src/app/(marketing)/pricing/page.tsx -- if the rate changes, change both.
// The price is expressed as a UnitPriceSpecification so the per-student,
// per-term basis is machine-readable rather than implied.
export function buildSoftwareApplicationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    url: SITE_URL,
    description:
      "School management software for Kenyan schools: admissions, academics (CBC), finance and M-Pesa fee collection, attendance, and parent communication in one platform.",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    audience: {
      "@type": "Audience",
      audienceType: "Schools in Kenya",
    },
    offers: {
      "@type": "Offer",
      price: "100",
      priceCurrency: "KES",
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: "100",
        priceCurrency: "KES",
        referenceQuantity: {
          "@type": "QuantitativeValue",
          value: 1,
          unitText: "student per term",
        },
      },
      url: `${SITE_URL}/pricing`,
      availability: "https://schema.org/InStock",
      eligibleRegion: { "@type": "Country", name: "Kenya" },
    },
  };
}

export function MarketingJsonLd() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(buildOrganizationJsonLd()),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(buildSoftwareApplicationJsonLd()),
        }}
      />
    </>
  );
}
