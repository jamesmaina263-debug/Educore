// The platform admin console is used through one shared super-admin login (James, Ben and
// Boniface). That login alone can't say WHO did something, so after signing in each person
// picks their own name and it is stamped onto the activity log.
//
// This is an accountability label, not authentication: the name is self-declared, and the
// cookie only records it. Real access control is still auth_is_super_admin() on the shared
// login. To add or remove a person, edit this list -- it is the single source of truth.
export const ADMIN_OPERATORS = ["James", "Ben", "Boniface"] as const;

export type AdminOperator = (typeof ADMIN_OPERATORS)[number];

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
