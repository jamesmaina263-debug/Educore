// WP 3.3: registration screen helpers (pure). The database function decides everything; this only parses its answers.
export const DIRECTOR_WHATSAPP_FLAG = "feature.bot.director";

export interface DirectorWhatsappStatus {
  eligible: boolean;
  registered: boolean;
  phoneMasked: string | null;
  optedInAt: string | null;
}

export function parseDirectorStatus(raw: unknown): DirectorWhatsappStatus {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    eligible: r.eligible === true,
    registered: r.registered === true,
    phoneMasked: typeof r.phone_masked === "string" ? r.phone_masked : null,
    optedInAt: typeof r.opted_in_at === "string" ? r.opted_in_at : null,
  };
}

const REGISTER_MESSAGES: Record<string, string> = {
  disabled: "Director WhatsApp questions are not switched on for this school.",
  consent_required: "Please tick the box to agree before registering.",
  invalid_phone: "That does not look like a Kenyan mobile number. Use a format like 0712 345 678.",
  phone_mismatch: "This number must match the phone number on your own staff profile. Update your profile first, then register.",
  phone_is_guardian: "This number is also registered as a parent at your school, so it cannot be used for director questions.",
  phone_in_use: "This number is already registered by someone else.",
};

/** Returns an error sentence, or null when the registration worked. */
export function registerErrorMessage(raw: unknown): string | null {
  const status = (raw && typeof raw === "object" ? (raw as Record<string, unknown>).status : null) as string | null;
  if (status === "registered") return null;
  return (status && REGISTER_MESSAGES[status]) || "Could not register this number. Please try again.";
}
