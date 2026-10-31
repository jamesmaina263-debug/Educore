import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Guards the safety properties of the report-card staff notification migration. The function itself
// was exercised against production data in a transaction that was rolled back (recipients by role and
// permission, once-only per unread link, no self-notification, nothing for a user without exams.read);
// these checks stop a later edit from silently removing those properties.

const root = path.resolve(__dirname, "../..");
const sql = readFileSync(path.join(root, "supabase/migrations/20261031200000_report_card_staff_notifications.sql"), "utf8");
const code = sql.replace(/^--.*$/gm, "");

describe("report card staff notification migration", () => {
  it("is additive: functions only, no new table, no change to existing objects", () => {
    expect(code).not.toMatch(/create\s+table/i);
    expect(code).not.toMatch(/alter\s+table/i);
    expect(code).not.toMatch(/drop\s+(table|policy|column)/i);
    expect([...code.matchAll(/create or replace function public\.(\w+)/gi)].map((m) => m[1]).sort()).toEqual([
      "_notify_report_card_once",
      "notify_report_card_event",
      "school_user_has_permission",
    ]);
  });

  it("delivers through the existing in-app primitive rather than a parallel system", () => {
    expect(code).toMatch(/notify_school_user\(p_recipient, p_subject, p_body, p_url, 'other'\)/);
    expect(code).not.toMatch(/insert\s+into\s+notification_logs/i);
  });

  it("only the event function is callable by signed-in users; the helpers are internal", () => {
    expect(code).toMatch(/revoke all on function public\.notify_report_card_event\(text, uuid, uuid, uuid, uuid\) from public, anon;/);
    expect(code).toMatch(/grant execute on function public\.notify_report_card_event\(text, uuid, uuid, uuid, uuid\) to authenticated;/);
    expect(code).toMatch(/revoke all on function public\.school_user_has_permission\(uuid, text\) from public, anon, authenticated;/);
    expect(code).toMatch(/revoke all on function public\._notify_report_card_once\(uuid, text, text, text\) from public, anon, authenticated;/);
    expect(code).not.toMatch(/grant execute on function public\.(school_user_has_permission|_notify_report_card_once)/i);
  });

  it("is scoped to the caller's school and gated on exams.read", () => {
    expect(code).toMatch(/v_school uuid := auth_school_id\(\)/);
    expect(code).toMatch(/not auth_has_permission\('exams\.read'\)/);
    expect(code).toMatch(/from exams where id = p_exam_id and school_id = v_school and status = 'closed'/);
    expect(code).toMatch(/where c\.school_id = v_school/);
    expect(code).toMatch(/su\.school_id = v_school/);
  });

  it("derives every count from report_cards, never from the caller", () => {
    expect(code).toMatch(/from report_cards rc/);
    // The callable function accepts only identifiers: no count, subject or text from the caller.
    const sig = code.match(/create or replace function public\.notify_report_card_event\(([\s\S]*?)\)\s*returns/i)?.[1] ?? "";
    expect([...sig.matchAll(/(p_\w+)\s+(?:text|uuid)/g)].map((m) => m[1])).toEqual(["p_event", "p_exam_id", "p_class_id", "p_stream_id", "p_student_id"]);
    for (const state of ["'ai'", "'none'", "'teacher_approved'", "'teacher_written'"]) expect(code).toContain(state);
  });

  it("stays quiet: nothing to act on, nobody about their own action, one unread per link", () => {
    expect(code).toMatch(/if v_count > 0/);
    expect(code).toMatch(/class_teacher_id <> v_caller/);
    expect(code).toMatch(/su\.id <> v_caller/);
    expect(code).toMatch(/nl\.read_at is null[\s\S]*nl\.dismissed_at is null/);
    expect(code).toMatch(/nl\.action_url = p_url[\s\S]*nl\.subject = p_subject/);
    expect(code).toMatch(/not \(su\.id = any\(v_notified\)\)/);
  });

  it("recipients follow effective permission, with the class teacher needing approve rights for work events", () => {
    expect(code).toMatch(/report_cards\.approve'\)/);
    expect(code).toMatch(/report_cards\.approve_any'\)/);
    expect(code).toMatch(/user_permission_overrides[\s\S]*role_permissions[\s\S]*school_id is null/);
  });

  it("links straight to the class/stream that needs attention", () => {
    expect(code).toContain("'/exams/report-cards?exam=' || p_exam_id || '&class=' || v_stream.class_id || '&stream=' || v_stream.id");
  });

  it("fails closed: verifies privileges and runs the function as real staff in rolled-back subtransactions", () => {
    expect(code).toMatch(/has_function_privilege\('anon'/);
    expect(code).toMatch(/errcode = 'P0099'/);
    expect(code).toMatch(/foreach ev in array array\['ready_for_comments', 'awaiting_approval', 'needs_reapproval', 'approved'\]/);
  });
});
