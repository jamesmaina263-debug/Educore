/** Turns a display name into a URL-safe slug fragment, e.g. for a new school. */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "school"
  );
}
