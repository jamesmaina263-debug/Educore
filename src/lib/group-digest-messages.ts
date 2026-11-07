// WP 3.4 / 3.5 formatting and dry-run summaries. Pure: no I/O, nothing is sent. Fails closed: a payload that does not look
// exactly right gives null, so a malformed row is counted and skipped, never sent with invented figures.
// The text is the BODY a later, separately approved step will put into a WhatsApp or SMS template; no template is chosen here.

import { formatBriefing } from "./director-messages";

function rec(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** The group admin's Saturday digest: one block per school (the WP 3.1 Saturday text), or null if any block is malformed. */
export function formatGroupDigest(payload: unknown): string | null {
  const p = rec(payload);
  if (!p || p.kind !== "group_saturday" || !Array.isArray(p.schools) || p.schools.length === 0) return null;
  const blocks: string[] = [];
  for (const b of p.schools) {
    const block = rec(b);
    if (!block || typeof block.school !== "string" || block.school.trim() === "") return null;
    const text = formatBriefing(block.figures);
    if (text === null) return null;
    blocks.push(`${block.school.trim()}\n${text}`);
  }
  return `Weekly group summary\n\n${blocks.join("\n\n")}`;
}

export type GroupDigestRow = {
  log_id: string;
  school_group_id: string;
  school_user_id: string;
  phone: string;
  payload: unknown;
};

export type GroupDigestSummary = {
  total: number;
  groups: number;
  schools_covered: number;
  formattable: number;
  unformattable: number;
};

/** Counts only (never phones, figures or text), for the dry-run route's response. */
export function summariseGroupDigests(rows: GroupDigestRow[] | null | undefined): GroupDigestSummary {
  const list = Array.isArray(rows) ? rows : [];
  let formattable = 0;
  let schools_covered = 0;
  for (const r of list) {
    if (formatGroupDigest(r.payload) !== null) formattable += 1;
    const p = rec(r.payload);
    if (p && Array.isArray(p.schools)) schools_covered += p.schools.length;
  }
  return {
    total: list.length,
    groups: new Set(list.map((r) => r.school_group_id)).size,
    schools_covered,
    formattable,
    unformattable: list.length - formattable,
  };
}

export type SameDayAbsenceRow = {
  log_id: string;
  school_id: string;
  student_id: string;
  guardian_user_id: string;
  phone: string;
};

export type SameDayAbsenceSummary = {
  total: number;
  schools: number;
  learners: number;
  guardians: number;
  /** Rows with a normalised Kenyan number (+254 and nine digits). The database already guarantees this; a count other than total is a bug. */
  valid_phone: number;
};

/** Counts only (never names, phones or text), for the dry-run route's response. */
export function summariseSameDayAbsence(rows: SameDayAbsenceRow[] | null | undefined): SameDayAbsenceSummary {
  const list = Array.isArray(rows) ? rows : [];
  return {
    total: list.length,
    schools: new Set(list.map((r) => r.school_id)).size,
    learners: new Set(list.map((r) => r.student_id)).size,
    guardians: new Set(list.map((r) => r.guardian_user_id)).size,
    valid_phone: list.filter((r) => typeof r.phone === "string" && /^\+254\d{9}$/.test(r.phone)).length,
  };
}
