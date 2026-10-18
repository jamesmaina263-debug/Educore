import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Guards the safety properties of the report-card release notification migration. The trigger's
// behaviour was exercised against a real Postgres engine when it was written (recipients,
// opt-out, once-only, never-blocks-approval); these checks stop a later edit from silently
// removing those properties.

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const sql = read("supabase/migrations/20261018090000_report_card_release_notification.sql");
const code = sql.replace(/^--.*$/gm, "");

describe("report card release notification migration", () => {
  it("is additive: one new internal table, no changes to existing objects", () => {
    expect([...code.matchAll(/create\s+table\s+(\w+)/gi)].map((m) => m[1])).toEqual(["report_card_release_notifications"]);
    expect(code).not.toMatch(/alter\s+table\s+(?!report_card_release_notifications)/i);
    expect(code).not.toMatch(/drop\s+(table|policy|column|function)/i);
    expect(code).toMatch(/alter table report_card_release_notifications enable row level security/i);
  });

  it("only fires when a card becomes released (approved/written), not for drafts", () => {
    expect(code).toMatch(/when \(new\.comment_source in \('teacher_approved', 'teacher_written'\)\)/);
    expect(code).toMatch(/old\.comment_source in \('teacher_approved', 'teacher_written'\)/);
  });

  it("is once per report card and respects each guardian's opt-out", () => {
    expect(code).toMatch(/insert into report_card_release_notifications[\s\S]*on conflict do nothing/);
    expect(code).toMatch(/notification_allowed\(g\.guardian_id, 'result_published', 'sms'\)/);
  });

  it("never blocks the teacher's approval if notification work fails", () => {
    expect(code).toMatch(/exception when others then\s+raise warning/);
  });

  it("is a locked-down SECURITY DEFINER function with a fixed search_path", () => {
    expect(code).toMatch(/security definer\s+set search_path to 'public'/);
    expect(code).toMatch(/revoke all on function public\.notify_guardians_on_report_card_release\(\) from public, anon, authenticated/);
  });

  it("SMS text carries no marks, rank or comment", () => {
    const body = code.match(/v_body := format\(([\s\S]*?)\);/)?.[1] ?? "";
    expect(body).toContain("report card is now available");
    expect(body).not.toMatch(/raw_score|average|rank|comment/i);
  });
});

describe("existing behaviour this feature relies on", () => {
  it("parents can still switch the category off in the portal preferences panel", () => {
    expect(read("src/components/notifications/preferences-panel.tsx")).toContain('"result_published"');
  });
  it("approval/write actions do not themselves send messages (the trigger is the single path)", () => {
    const actions = read("src/app/(app)/exams/report-cards/actions.ts").replace(/\/\/.*$/gm, "");
    expect(actions).not.toMatch(/notification_logs|queue_communication/);
  });
});
