/**
 * Reference data for the institution signup form (src/app/signup). Shared
 * between the client form (rendering <Select> options) and the server
 * action (revalidating submitted values — never trust the client for
 * anything that ends up in a database CHECK constraint).
 *
 * Country/currency *names* are resolved at render time via Intl.DisplayNames
 * so we only have to maintain the stable ISO code lists below, never a
 * hand-maintained name column that can drift out of date.
 */

export const TITLE_OPTIONS = [
  "Mr",
  "Mrs",
  "Ms",
  "Miss",
  "Dr",
  "Prof",
  "Eng",
  "Rev",
  "Sheikh",
  "Bishop",
] as const;
export type Title = (typeof TITLE_OPTIONS)[number];

// Replaces the screenshot's "Gender" field per the school (not the signer)
// — the institution's student intake, not a person's gender.
export const SCHOOL_TYPE_OPTIONS = [
  { value: "boys", label: "Boys" },
  { value: "girls", label: "Girls" },
  { value: "mixed", label: "Mixed" },
] as const;
export type SchoolType = (typeof SCHOOL_TYPE_OPTIONS)[number]["value"];

// Kenyan CBC-aligned education cycles, plus the non-CBC tiers this platform
// already has NEMIS/exam-grading support for (see nemis_integration migration).
export const CYCLE_OPTIONS = [
  { value: "pre_primary", label: "Pre-Primary" },
  { value: "primary", label: "Primary" },
  { value: "junior_secondary", label: "Junior Secondary" },
  { value: "senior_secondary", label: "Senior Secondary" },
  { value: "tvet", label: "TVET" },
  { value: "college", label: "College" },
  { value: "university", label: "University" },
] as const;
export type Cycle = (typeof CYCLE_OPTIONS)[number]["value"];

// "Organisation state" in the screenshot — the institution's ownership/legal
// status, not a geographic state/province.
export const OWNERSHIP_TYPE_OPTIONS = [
  { value: "public", label: "Public" },
  { value: "private", label: "Private" },
  { value: "faith_based", label: "Faith-Based" },
  { value: "community_ngo", label: "Community / NGO" },
  { value: "international", label: "International" },
] as const;
export type OwnershipType = (typeof OWNERSHIP_TYPE_OPTIONS)[number]["value"];

// "Type" in the screenshot — the institution's level, distinct from Cycles
// (which cycles it runs) and School Type (student intake).
export const INSTITUTION_TYPE_OPTIONS = [
  { value: "primary_school", label: "Primary School" },
  { value: "secondary_school", label: "Secondary School" },
  { value: "primary_and_secondary", label: "Primary & Secondary" },
  { value: "tvet_institute", label: "TVET Institute" },
  { value: "college", label: "College" },
  { value: "university", label: "University" },
] as const;
export type InstitutionType = (typeof INSTITUTION_TYPE_OPTIONS)[number]["value"];

/** Current year and the next one, per the confirmed spec ("current year and coming year"). */
export function startingYearOptions(now = new Date()): number[] {
  const year = now.getFullYear();
  return [year, year + 1];
}

// ISO 3166-1 alpha-2 codes. Names are resolved via Intl.DisplayNames so this
// list only ever needs a code, never a name that can go stale.
export const COUNTRY_CODES = [
  "KE", "UG", "TZ", "RW", "BI", "SS", "ET", "SO", "ZA", "NG", "GH", "EG",
  "MA", "DZ", "TN", "LY", "SD", "ZM", "ZW", "MW", "MZ", "NA", "BW", "SZ",
  "LS", "AO", "CD", "CG", "CM", "CI", "SN", "ML", "BF", "NE", "TD", "GA",
  "TG", "BJ", "SL", "LR", "GN", "GM", "MR", "DJ", "ER", "GB", "US", "CA",
  "IN", "PK", "BD", "CN", "JP", "KR", "AE", "SA", "QA", "AU", "NZ", "IE",
  "DE", "FR", "IT", "ES", "PT", "NL", "BE", "CH", "SE", "NO", "DK", "FI",
  "PL", "BR", "MX", "AR", "PH", "MY", "SG", "ID", "TH", "VN",
] as const;

// ISO 4217 currency codes actually relevant to a schools platform operating
// out of Kenya (regional + major international). Names resolved via
// Intl.DisplayNames the same way as countries.
export const CURRENCY_CODES = [
  "KES", "UGX", "TZS", "RWF", "BIF", "SSP", "ETB", "ZAR", "NGN", "GHS",
  "EGP", "MAD", "ZMW", "MWK", "MZN", "USD", "GBP", "EUR", "CAD", "AUD",
  "INR", "AED", "SAR", "CNY", "JPY",
] as const;
export type CurrencyCode = (typeof CURRENCY_CODES)[number];

export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function currencyName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "currency" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** All IANA time zone identifiers supported by the current runtime. */
export function timezoneOptions(): string[] {
  if (typeof Intl.supportedValuesOf === "function") {
    return Intl.supportedValuesOf("timeZone");
  }
  // Extremely old runtime fallback — Kenya's own zone always available.
  return ["Africa/Nairobi", "UTC"];
}

const TITLE_SET = new Set<string>(TITLE_OPTIONS);
const SCHOOL_TYPE_SET = new Set<string>(SCHOOL_TYPE_OPTIONS.map((o) => o.value));
const CYCLE_SET = new Set<string>(CYCLE_OPTIONS.map((o) => o.value));
const OWNERSHIP_TYPE_SET = new Set<string>(OWNERSHIP_TYPE_OPTIONS.map((o) => o.value));
const INSTITUTION_TYPE_SET = new Set<string>(INSTITUTION_TYPE_OPTIONS.map((o) => o.value));
const COUNTRY_SET = new Set<string>(COUNTRY_CODES);
const CURRENCY_SET = new Set<string>(CURRENCY_CODES);

export function isValidTitle(v: string): v is Title {
  return TITLE_SET.has(v);
}
export function isValidSchoolType(v: string): v is SchoolType {
  return SCHOOL_TYPE_SET.has(v);
}
export function isValidCycle(v: string): v is Cycle {
  return CYCLE_SET.has(v);
}
export function isValidOwnershipType(v: string): v is OwnershipType {
  return OWNERSHIP_TYPE_SET.has(v);
}
export function isValidInstitutionType(v: string): v is InstitutionType {
  return INSTITUTION_TYPE_SET.has(v);
}
export function isValidCountryCode(v: string): boolean {
  return COUNTRY_SET.has(v);
}
export function isValidCurrencyCode(v: string): boolean {
  return CURRENCY_SET.has(v);
}
export function isValidStartingYear(v: number): boolean {
  return startingYearOptions().includes(v);
}
