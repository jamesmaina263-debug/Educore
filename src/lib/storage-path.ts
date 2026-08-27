/**
 * Builds a safe Supabase Storage object key for a user-uploaded file.
 *
 * The original filename is untrusted (these upload paths are reachable from
 * public, unauthenticated forms like the admissions application). We keep a
 * short slice of it for human-readability in the dashboard, but strip it
 * down to a conservative charset and cap its length so it can never inject
 * extra "/" path segments, control characters, or an unreasonably long key
 * into the storage bucket.
 */
export function safeStorageFilename(originalName: string): string {
  const lastDot = originalName.lastIndexOf(".");
  const hasExt = lastDot > 0 && lastDot < originalName.length - 1;
  const base = hasExt ? originalName.slice(0, lastDot) : originalName;
  const ext = hasExt ? originalName.slice(lastDot + 1) : "";

  const cleanBase =
    base
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 60) || "file";

  const cleanExt = ext.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10);

  return cleanExt ? `${cleanBase}.${cleanExt}` : cleanBase;
}
