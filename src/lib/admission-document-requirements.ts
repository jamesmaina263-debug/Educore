export const REQUIREMENT_LABEL_MAX_LENGTH = 60;

export function validateRequirementLabel(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const value = raw.trim().replace(/\s+/g, " ");
  if (!value) return { ok: false, error: "Enter a name for this document." };
  if (value.length > REQUIREMENT_LABEL_MAX_LENGTH) {
    return { ok: false, error: `Name must be ${REQUIREMENT_LABEL_MAX_LENGTH} characters or fewer.` };
  }
  return { ok: true, value };
}

export const DEFAULT_REQUIREMENT_CATEGORIES = [
  "birth_certificate",
  "previous_report",
  "guardian_id",
  "transfer_letter",
  "passport_photo",
] as const;

export const MAX_REQUIREMENTS_PER_SCHOOL = 30;

/** Custom categories are the only ones a school may delete; the built-in five can only be made optional. */
export function isCustomCategory(category: string): boolean {
  return /^custom_[a-z0-9_]{1,60}$/.test(category);
}

/**
 * Storage-safe category key for a school-defined document: custom_<slug>_<4 random chars>.
 * Must satisfy the database check (lowercase letters, digits, underscore only) because the key
 * is embedded in storage object paths.
 */
export function makeCustomCategory(label: string, random: () => number = Math.random): string {
  const slug = label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "document";
  const suffix = Array.from({ length: 4 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(random() * 36)]).join("");
  return `custom_${slug}_${suffix}`;
}
