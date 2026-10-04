// Single source of truth for EduCore's corporate identity on official documents (invoices, and
// any future letters/quotations). Brand colours mirror src/app/globals.css (--brand-navy-*,
// --brand-gold-*); typography is Inter + IBM Plex Mono, the same pairing the product and
// marketing site use. Keep the letterhead consistent by changing values HERE, not in the PDF code.

export const BRAND = {
  navy900: "#0A1730",
  navy950: "#060C1F",
  navy800: "#132145",
  gold500: "#D9A627",
  gold300: "#F2D182",
  // Neutral text tones derived from navy-900 (70% / 50% on white), used for secondary copy.
  ink70: "#545D6E",
  ink50: "#848B97",
  rule: "#E3E6EB",
  panel: "#F6F7F9",
  danger: "#B42318",
} as const;

export const COMPANY = {
  /** Name shown in the letterhead header. */
  tradingName: "EduCore Africa",
  /** Registered entity (privacy policy, Reg. No.), shown in the footer of official documents. */
  legalName: "EduCore Technologies Ltd",
  registrationNo: "PVT-93SSQEELA",
  address: "7th Floor, Sanlam Towers, Waiyaki Way, Westlands, Nairobi, Kenya",
  website: { label: "educoreafrica.com", url: "https://www.educoreafrica.com" },
  email: { label: "info@educoreafrica.com", url: "mailto:info@educoreafrica.com" },
  whatsapp: { label: "+254 702 904 562", url: "https://wa.me/254702904562" },
  tagline: "School operations, brought into one connected platform.",
} as const;

export const DEFAULT_THANK_YOU = "Thank you for partnering with EduCore Africa.";
