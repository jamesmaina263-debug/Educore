// WP 3.3: directors ask the school bot for figures in plain words. No relative imports and no Deno imports on
// purpose, so vitest/tsc can load this file (see guardianRequests.ts). The AI/keyword layer here only ever picks a
// TOPIC; every number in a reply comes from the database function director_whatsapp_answer (fixed queries).

export type DirectorTopic =
  | "collection_today"
  | "collection_week"
  | "outstanding"
  | "top_arrears"
  | "attendance_today"
  | "absentees_today"
  | "enrolment";

export const DIRECTOR_FLAG = "feature.bot.director";

const NUMBER_TOPICS: Record<string, DirectorTopic> = {
  "1": "collection_today",
  "2": "collection_week",
  "3": "outstanding",
  "4": "top_arrears",
  "5": "attendance_today",
  "6": "absentees_today",
  "7": "enrolment",
};

const has = (text: string, words: string[]) => words.some((w) => text.includes(w));

/** Raw text in, a topic (or "menu") out. Anything unclear is "menu": the director is shown the options, never a guess. */
export function classifyDirectorTopic(raw: string): DirectorTopic | "menu" {
  const text = raw.trim().toLowerCase();
  if (!text) return "menu";
  if (NUMBER_TOPICS[text]) return NUMBER_TOPICS[text];
  if (has(text, ["absent", "absentee", "hawapo", "missing today"])) return "absentees_today";
  if (has(text, ["attendance", "present", "mahudhurio"])) return "attendance_today";
  if (/\btop\b/.test(text) || has(text, ["biggest", "highest", "who owes", "largest"])) return "top_arrears";
  if (has(text, ["outstanding", "arrears", "owed", "unpaid", "balance", "bakaa", "salio"])) return "outstanding";
  if (has(text, ["collect", "received", "paid", "payments", "mkusanyo", "income", "mpesa", "m-pesa"])) {
    return has(text, ["week", "wiki", "7 days", "seven days"]) ? "collection_week" : "collection_today";
  }
  if (has(text, ["how many students", "how many learners", "enrol", "students", "learners", "wanafunzi"])) return "enrolment";
  return "menu";
}

export function directorMenuText(prefix = ""): string {
  return (
    prefix +
    "School figures. Reply with a number or ask in your own words:\n" +
    "1. Collections today\n2. Collections, last 7 days\n3. Outstanding fees\n4. Biggest arrears\n" +
    "5. Attendance today\n6. Who is absent today\n7. Number of learners"
  );
}

export function formatKes(n: unknown): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "KES 0";
  return "KES " + Math.round(v).toLocaleString("en-US");
}

const METHOD_LABEL: Record<string, string> = { mpesa: "M-Pesa", cash: "Cash", bank: "Bank", cheque: "Cheque" };

function footer(asOf: unknown): string {
  const d = typeof asOf === "string" ? new Date(asOf) : null;
  if (!d || Number.isNaN(d.getTime())) return "\n\nLive from your school's records.";
  const t = d.toLocaleTimeString("en-GB", { timeZone: "Africa/Nairobi", hour: "2-digit", minute: "2-digit" });
  return `\n\nLive from your school's records as at ${t}.`;
}

// deno-lint-ignore no-explicit-any
type Json = any;

export function formatDirectorReply(topic: DirectorTopic, data: Json, asOf: unknown): string {
  const d = data ?? {};
  let body: string;
  switch (topic) {
    case "collection_today":
    case "collection_week": {
      const label = topic === "collection_week" ? "Collections, last 7 days (including today)" : "Collections today";
      const count = Number(d.count ?? 0);
      const methods = Object.entries((d.by_method ?? {}) as Record<string, unknown>)
        .map(([m, amt]) => `${METHOD_LABEL[m] ?? m} ${formatKes(amt)}`)
        .join(", ");
      body = count === 0
        ? `${label}: nothing recorded.`
        : `${label}: ${formatKes(d.total)} from ${count} payment${count === 1 ? "" : "s"}.${methods ? ` By method: ${methods}.` : ""}`;
      break;
    }
    case "outstanding": {
      const owing = Number(d.learners_owing ?? 0);
      body = `Outstanding fees: ${formatKes(d.outstanding)} across ${owing} learner${owing === 1 ? "" : "s"}.`;
      if (Number(d.unallocated_received ?? 0) > 0) {
        body += ` Also received but not yet allocated to a learner: ${formatKes(d.unallocated_received)} (not counted above).`;
      }
      break;
    }
    case "top_arrears": {
      const rows: { name: string; balance: unknown }[] = Array.isArray(d.rows) ? d.rows : [];
      body = rows.length === 0
        ? "No active learner currently owes fees."
        : "Biggest arrears:\n" + rows.map((r, i) => `${i + 1}. ${r.name} - ${formatKes(r.balance)}`).join("\n");
      break;
    }
    case "attendance_today": {
      const marked = Number(d.marked ?? 0);
      const active = Number(d.active_learners ?? 0);
      body = marked === 0
        ? `No attendance has been marked yet today (${active} active learners).`
        : `Attendance today: ${Number(d.present ?? 0)} present, ${Number(d.late ?? 0)} late, ${Number(d.absent ?? 0)} absent. Marked for ${marked} of ${active} active learners.`;
      break;
    }
    case "absentees_today": {
      const total = Number(d.total ?? 0);
      const names: string[] = Array.isArray(d.names) ? d.names : [];
      body = total === 0
        ? "Nobody is marked absent today (or attendance has not been marked yet)."
        : `Absent today: ${total}.\n${names.join(", ")}${total > names.length ? `, and ${total - names.length} more` : ""}`;
      break;
    }
    default:
      body = `Active learners: ${Number(d.active_learners ?? 0)}.`;
  }
  return body + footer(asOf);
}

export interface RpcClient {
  // deno-lint-ignore no-explicit-any
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: any; error: { message: string } | null }>;
}

export interface DirectorResult {
  handled: boolean;
  reply?: string;
}

/**
 * Called by the webhook before any guardian handling. handled=false means "not a director, carry on exactly as before"
 * (also on any lookup error, so a database hiccup can never turn a guardian message into a director answer).
 * A registered director always gets handled=true: a figure, the menu, or a calm "try again" message.
 */
export async function tryHandleDirectorMessage(input: { supabase: RpcClient; phone: string; text: string; messageSid: string | null }): Promise<DirectorResult> {
  let found: unknown;
  try {
    const res = await input.supabase.rpc("director_whatsapp_lookup", { p_phone: input.phone });
    if (res.error) return { handled: false };
    found = res.data;
  } catch {
    return { handled: false };
  }
  if (!Array.isArray(found) || found.length !== 1) return { handled: false };

  const topic = classifyDirectorTopic(input.text);
  if (topic === "menu") return { handled: true, reply: directorMenuText("") };

  const { data, error: answerError } = await input.supabase.rpc("director_whatsapp_answer", {
    p_phone: input.phone,
    p_topic: topic,
    p_message_sid: input.messageSid,
  });
  if (answerError) {
    console.error("[director-bot] answer failed:", answerError.message);
    return { handled: true, reply: "I couldn't read the figures just now. Please try again in a few minutes." };
  }
  switch (data?.status) {
    case "ok":
      return { handled: true, reply: formatDirectorReply(topic, data.data, data.as_of) };
    case "duplicate":
      return { handled: true }; // a Twilio retry of a message already answered: say nothing more
    case "not_director":
      return { handled: false }; // eligibility ended between the two calls
    default:
      return { handled: true, reply: directorMenuText("") };
  }
}
