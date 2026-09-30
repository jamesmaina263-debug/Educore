// Real top-level folders under src/app/(app) -- i.e. every actual staff-app
// route. Used to tell "/dashboard" (a real route, bare/unslugged) apart from
// "/gititu-high-school/dashboard" (a real route, slug-prefixed) so the same
// first path segment can be handled correctly either way. Keep in sync with
// src/app/(app)'s folder list if a new top-level module is ever added.
export const APP_ROUTE_SEGMENTS = new Set([
  "academics", "admin", "admissions", "ai", "announcements", "attendance", "boarding", "campuses",
  "communication", "connect", "dashboard", "discipline", "exams", "finance", "health",
  "homework", "integrations", "inventory", "library", "parents", "payroll", "performance", "pt-meetings",
  "reports", "settings", "staff", "students", "transport",
]);
