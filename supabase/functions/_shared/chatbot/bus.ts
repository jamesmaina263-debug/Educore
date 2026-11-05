// WP 5.3 (bot part): "where is the bus" over the WhatsApp bot. Pure (no imports, no Deno globals) so the same file
// runs in the edge function AND in the app's unit tests (src/lib/bot-bus.test.ts).
//
// Strictly read-only, and the reply is built only from what bot_guardian_bus_status() returned. It never contains
// coordinates, a vehicle registration, a driver or another child: the reply text is stored in the message log, so the
// position itself stays on the parent portal map. Anything unexpected is an error, and the dispatcher turns an error
// into "pass to the school office", never into a guess about where a child's bus is.

export type BusLang = "en" | "sw";

export type BotBusStatus =
  | { status: "live"; route: string | null; stop: string | null; ageSeconds: number }
  | { status: "not_live"; route: string | null; stop: string | null }
  | { status: "no_vehicle"; route: string | null }
  | { status: "no_assignment" };

// Whole words only, so "business" or "busy" never counts. "basi" is the Kiswahili word for bus.
const BUS_RE = /(^|[^a-z])(bus|buses|basi|school bus|school van|schoolbus)([^a-z]|$)/;

/** True when the message is about the school bus. Used only when the school has the feature on. */
export function mentionsBus(rawText: string): boolean {
  return BUS_RE.test(rawText.trim().toLowerCase());
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function textOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, 80) : null;
}

/**
 * Reads the database answer. Returns null for "forbidden", "disabled", anything unrecognised or malformed, so the
 * caller escalates rather than guessing. Fails closed.
 */
export function parseBotBusStatus(raw: unknown): BotBusStatus | null {
  if (!isRecord(raw) || typeof raw.status !== "string") return null;
  switch (raw.status) {
    case "live": {
      const age = typeof raw.age_seconds === "number" ? raw.age_seconds : Number(raw.age_seconds);
      if (!Number.isFinite(age) || age < 0) return null;
      return { status: "live", route: textOrNull(raw.route), stop: textOrNull(raw.stop), ageSeconds: Math.floor(age) };
    }
    case "not_live":
      return { status: "not_live", route: textOrNull(raw.route), stop: textOrNull(raw.stop) };
    case "no_vehicle":
      return { status: "no_vehicle", route: textOrNull(raw.route) };
    case "no_assignment":
      return { status: "no_assignment" };
    default:
      return null;
  }
}

function ageText(lang: BusLang, seconds: number): string {
  if (seconds < 60) return lang === "sw" ? "sasa hivi" : "just now";
  const m = Math.floor(seconds / 60);
  return lang === "sw" ? `dakika ${m} zilizopita` : `${m} min ago`;
}

function where(lang: BusLang, route: string | null, stop: string | null): string {
  const parts: string[] = [];
  if (route) parts.push(lang === "sw" ? `njia: ${route}` : `route: ${route}`);
  if (stop) parts.push(lang === "sw" ? `kituo: ${stop}` : `stop: ${stop}`);
  return parts.length ? ` (${parts.join(", ")})` : "";
}

/** Fixed English / Kiswahili templates. The Kiswahili is a first draft: needs native review (open item O-34). */
export function busReplyText(lang: BusLang, name: string, s: BotBusStatus): string {
  if (lang === "sw") {
    switch (s.status) {
      case "live":
        return `Basi la ${name}${where(lang, s.route, s.stop)} linatuma mahali lilipo sasa (limesasishwa ${ageText(lang, s.ageSeconds)}). Fungua tovuti ya wazazi kuliona kwenye ramani.`;
      case "not_live":
        return `Basi la ${name}${where(lang, s.route, s.stop)} halitumi mahali lilipo kwa sasa. Jaribu tena baadaye au uwasiliane na ofisi ya shule.`;
      case "no_vehicle":
        return `${name} yuko kwenye njia ya basi${s.route ? ` (${s.route})` : ""}, lakini shule bado haijaweka basi mahususi. Tafadhali wasiliana na ofisi ya shule.`;
      case "no_assignment":
        return `${name} hajapangiwa usafiri wa basi la shule kwa sasa.`;
    }
  }
  switch (s.status) {
    case "live":
      return `${name}'s bus${where(lang, s.route, s.stop)} is sharing its live position (updated ${ageText(lang, s.ageSeconds)}). Open the parent portal to see it on the map.`;
    case "not_live":
      return `${name}'s bus${where(lang, s.route, s.stop)} is not sharing a live position right now. Please try again later or contact the school office.`;
    case "no_vehicle":
      return `${name} is on a bus route${s.route ? ` (${s.route})` : ""}, but the school has not set a specific bus yet. Please contact the school office.`;
    case "no_assignment":
      return `${name} is not currently assigned to school bus transport.`;
  }
}

// ---- The lookup itself (structural client type so it needs no imports) -----------------------------------

export interface BusRpcClient {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

/**
 * Asks the database and builds the reply. Throws on a database error and on any answer the bot must not give
 * (forbidden, disabled, unknown, malformed) so the dispatcher escalates to the school office instead of guessing.
 */
export async function answerBusQuestion(
  client: BusRpcClient,
  ids: { schoolId: string; guardianUserId: string; studentId: string },
  lang: BusLang,
  childName: string,
): Promise<string> {
  const { data, error } = await client.rpc("bot_guardian_bus_status", {
    p_school_id: ids.schoolId,
    p_guardian_user_id: ids.guardianUserId,
    p_student_id: ids.studentId,
  });
  if (error) throw new Error(`bot_guardian_bus_status failed: ${error.message}`);
  const status = parseBotBusStatus(data);
  if (!status) throw new Error("bot_guardian_bus_status returned a status the bot does not answer");
  return busReplyText(lang, childName, status);
}
