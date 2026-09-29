// The platform admin console is used through one shared super-admin login (James, Ben and
// Boniface). That login alone can't say WHO did something, so after signing in each person
// picks their own name and it is stamped onto the activity log.
//
// This is an accountability label, not authentication: the name is self-declared, and the
// cookie only records it. Real access control is still auth_is_super_admin() on the shared
// login. To add or remove a person, edit this list -- it is the single source of truth.
export const ADMIN_OPERATORS = ["James", "Ben", "Boniface"] as const;

export type AdminOperator = (typeof ADMIN_OPERATORS)[number];

// Fixed work email for each operator -- the code always goes here, never to an address the
// person types in, so picking "Ben" and verifying with your own inbox is not possible.
export const ADMIN_OPERATOR_EMAILS: Record<AdminOperator, string> = {
  James: "james.maina@educoreafrica.com",
  Ben: "ben.kimuyu@educoreafrica.com",
  Boniface: "boniface.k@educoreafrica.com",
};

// Distinct purpose string for generate_otp/verify_otp (supabase/migrations/*_otp*.sql) so this
// never collides with, or is affected by rate limits from, parent-login OTP codes that also use
// these RPCs and the same email addresses could theoretically also be a parent's.
export const ADMIN_OPERATOR_OTP_PURPOSE = "platform_admin_operator";

// James asked (2026-09-29) to skip the emailed-code step for himself only -- Ben and Boniface
// still must verify. This is the single place that decision lives; otp-actions.ts's bypass
// action is the only code path that reads it, so changing this list is the only change needed
// to add/remove someone from the exemption.
const ADMIN_OPERATOR_OTP_EXEMPT: ReadonlySet<AdminOperator> = new Set(["James"]);

export function operatorRequiresOtp(operator: AdminOperator): boolean {
  return !ADMIN_OPERATOR_OTP_EXEMPT.has(operator);
}

export const ADMIN_OPERATOR_COOKIE = "edu_admin_operator";

// Long enough for a working day, short enough that a forgotten session doesn't keep
// attributing actions to whoever used the machine last. The cookie is also cleared on every
// login and logout.
export const ADMIN_OPERATOR_MAX_AGE_SECONDS = 60 * 60 * 12;

export function isAdminOperator(value: unknown): value is AdminOperator {
  return typeof value === "string" && (ADMIN_OPERATORS as readonly string[]).includes(value);
}

// Only ever redirect back into the admin console -- never to an attacker-supplied URL.
export function safeAdminNextPath(value: unknown): string {
  if (typeof value !== "string") return "/admin";
  if (!value.startsWith("/admin")) return "/admin";
  if (value.startsWith("//") || value.includes("\\") || value.includes("://") || value.includes("..")) return "/admin";
  if (value === "/admin/who" || value.startsWith("/admin/who/") || value.startsWith("/admin/who?")) return "/admin";
  return value;
}
