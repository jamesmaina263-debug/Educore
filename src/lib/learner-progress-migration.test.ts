import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Guards the safety properties of the learner progress report migration. Its behaviour (28 checks:
// permission, school scoping, release-inherited read access, direct writes denied, term-only
// attendance, RLS honoured by the attendance summary, settings whitelist) was proven against a real
// Postgres engine when it was written; these checks stop a later edit silently removing them.
const sql = readFileSync(path.resolve(__dirname, "../../supabase/migrations/20261022090000_learner_progress_report.sql"), "utf8");
const code = sql.replace(/^--.*$/gm, "");

describe("learner progress report migration", () => {
  it("is additive: one new table, the other objects are functions; no existing table is altered or dropped", () => {
    expect([...code.matchAll(/create\s+table\s+(\w+)/gi)].map((m) => m[1])).toEqual(["report_card_head_comments"]);
    expect(code).not.toMatch(/alter\s+table\s+(?!report_card_head_comments)/i);
    expect(code).not.toMatch(/\bdrop\s+(table|policy|column|function)/i);
    expect(code).not.toMatch(/update\s+public\.(?!schools)|delete\s+from\s+public\.(?!report_card_head_comments)/i);
  });

  it("keeps the head comment OFF report_cards so a class teacher's own-class update policy can never write it", () => {
    expect(code).not.toMatch(/alter\s+table[^;]*report_cards[^;]*add\s+column/i);
    expect(code).toMatch(/create table report_card_head_comments/);
  });

  it("the head comment table has a select policy that requires the report card to be visible, and NO write policies", () => {
    const policies = [...code.matchAll(/create policy\s+(\w+)\s+on\s+(\w+)\s+for\s+(\w+)/gi)].map((m) => `${m[2]}:${m[3]}`);
    expect(policies).toEqual(["report_card_head_comments:select"]);
    expect(code).toMatch(/exists \(select 1 from report_cards rc where rc\.id = report_card_head_comments\.report_card_id\)/);
    expect(code).toMatch(/school_id = \(select auth_school_id\(\)\)/);
  });

  it("writes only through a permission-checked, school-scoped SECURITY DEFINER function", () => {
    expect(code).toMatch(/auth_has_permission\('report_cards\.comment_head'\)/);
    expect(code).toMatch(/v_card_school <> v_school_id/);
    expect(code).toMatch(/set_report_card_head_comment\(p_report_card_id uuid, p_comment text\)[\s\S]*?security definer\s+set search_path to 'public'/);
    expect(code).toMatch(/revoke all on function public\.set_report_card_head_comment\(uuid, text\) from public, anon;/);
  });

  it("the attendance summary is SECURITY INVOKER (the register's own RLS applies) and limited to the exam's term", () => {
    // Inspect only this function's own body (from its create statement to its closing $function$;).
    const body = code.match(/create or replace function public\.report_card_attendance_summary[\s\S]*?\$function\$;/)?.[0] ?? "";
    expect(body).toContain("security invoker");
    expect(body).not.toContain("security definer");
    expect(code).toMatch(/sa\.attendance_date between t\.start_date and t\.end_date/);
    expect(code).toMatch(/revoke all on function public\.report_card_attendance_summary\(uuid, uuid\[\]\) from public, anon;/);
  });

  it("extends the settings whitelist without dropping the original four keys", () => {
    const keys = [...(code.match(/v_known_keys text\[\] := array\[([^\]]+)\]/)?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(keys).toEqual(["ranking_enabled", "show_competency_ratings", "show_signatures", "show_class_statistics", "show_attendance", "show_head_teacher_comment", "show_parent_acknowledgement"]);
  });

  it("grants the new permission only to principal, deputy principal and school owner", () => {
    expect(code).toMatch(/'report_cards\.comment_head', true[\s\S]*?name in \('principal', 'deputy_principal', 'school_owner'\)/);
  });
});

describe("the comment path stays human-written", () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  it.each(["src/app/(app)/exams/report-cards/head-comment-actions.ts", "src/components/exams/head-teacher-comment-editor.tsx"])("%s uses no AI", (file) => {
    const code2 = strip(readFileSync(path.resolve(__dirname, "../../", file), "utf8"));
    expect(code2).not.toMatch(/gemini|GEMINI|draftCommentWithAI|anthropic|openai/i);
  });
  it("the head comment permission is listed in the permissions catalog so admins can grant it", () => {
    expect(readFileSync(path.resolve(__dirname, "permissions-catalog.ts"), "utf8")).toContain('"report_cards.comment_head"');
  });
});
