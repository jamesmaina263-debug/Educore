// Helpers for school-supplied ("existing") admission numbers. The database trigger
// assign_admission_number() is the authority (trim, per-school uniqueness incl. letter case,
// race-safety); these helpers give staff early, friendly feedback and map DB errors to text.

export const ADMISSION_NUMBER_MAX_LENGTH = 30;

const ALLOWED = /^[A-Za-z0-9/._\- ]+$/;

/** Same normalization the database applies: trim; blank means "not supplied". */
export function normalizeAdmissionNumber(raw: string | null | undefined): string {
  return (raw ?? "").trim();
}

export function validateAdmissionNumber(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const value = normalizeAdmissionNumber(raw);
  if (!value) return { ok: false, error: "Enter the student's existing admission number." };
  if (value.length > ADMISSION_NUMBER_MAX_LENGTH) {
    return { ok: false, error: `Admission number must be ${ADMISSION_NUMBER_MAX_LENGTH} characters or fewer.` };
  }
  if (!ALLOWED.test(value) || !/[A-Za-z0-9]/.test(value)) {
    return { ok: false, error: "Use only letters, numbers, spaces and / . _ - (for example LB/004/2026)." };
  }
  return { ok: true, value };
}

/** Escape LIKE wildcards so ilike behaves as a case-insensitive equality check. */
export function escapeIlike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Turn a database error from saving an admission number into a message for staff. */
export function friendlyAdmissionNumberError(message: string, value?: string): string | null {
  const label = value ? `Admission number ${value}` : "This admission number";
  if (/students_school_id_admission_number_key|duplicate key/i.test(message)) {
    return `${label} is already assigned to another student in your school.`;
  }
  if (/differ only by letter case/i.test(message)) {
    return `${label} is already assigned to another student in your school (numbers are not case-sensitive).`;
  }
  if (/cannot be cleared/i.test(message)) {
    return "An admission number cannot be removed once it has been assigned.";
  }
  return null;
}
