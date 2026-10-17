export const REQUIREMENT_LABEL_MAX_LENGTH = 60;

export function validateRequirementLabel(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const value = raw.trim().replace(/\s+/g, " ");
  if (!value) return { ok: false, error: "Enter a name for this document." };
  if (value.length > REQUIREMENT_LABEL_MAX_LENGTH) {
    return { ok: false, error: `Name must be ${REQUIREMENT_LABEL_MAX_LENGTH} characters or fewer.` };
  }
  return { ok: true, value };
}
