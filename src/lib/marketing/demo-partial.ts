// Validation for step 1 of the two-step demo request form (name, school, email, optional
// phone) -- the part that is saved as soon as the visitor presses Continue, before they have
// finished the form. Deliberately has no "use client" / "use server" directive so the server
// action and the unit tests can both import it.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Field length caps. The full form has none, but this endpoint stores data from people who
// never pressed the final submit button, so keep what a script could stuff into it small.
const MAX_NAME = 120;
const MAX_SCHOOL = 200;
const MAX_EMAIL = 254;
const MAX_PHONE = 40;

export type DemoContactStep = {
  name: string;
  schoolName: string;
  /** Lowercased and trimmed so the same visitor can be matched when they finish the form. */
  email: string;
  phone: string | null;
};

export type DemoContactStepResult =
  | { ok: true; value: DemoContactStep }
  | { ok: false; message: string };

export function normalizeLeadEmail(raw: unknown): string {
  return String(raw ?? "").trim().toLowerCase();
}

export function parseDemoContactStep(formData: FormData): DemoContactStepResult {
  const name = String(formData.get("name") ?? "").trim();
  const schoolName = String(formData.get("school_name") ?? "").trim();
  const email = normalizeLeadEmail(formData.get("email"));
  const phone = String(formData.get("phone") ?? "").trim();

  if (!name || !schoolName || !email) {
    return { ok: false, message: "Name, school, and email are required." };
  }
  if (email.length > MAX_EMAIL || !EMAIL_RE.test(email)) {
    return { ok: false, message: "Enter a valid email address." };
  }

  return {
    ok: true,
    value: {
      name: name.slice(0, MAX_NAME),
      schoolName: schoolName.slice(0, MAX_SCHOOL),
      email,
      phone: phone ? phone.slice(0, MAX_PHONE) : null,
    },
  };
}
