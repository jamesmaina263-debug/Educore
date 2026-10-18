import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Guards the safety properties of the percentage-average ranking migration. Its behaviour (all-100
// schools identical to the old function, the mixed-maximum bug fixed, genuine zero vs missing,
// max 0 safe) was proven against a real Postgres engine when it was written; these checks stop a
// later edit silently removing those properties.

const root = path.resolve(__dirname, "../..");
const sql = readFileSync(path.join(root, "supabase/migrations/20261018120000_class_rankings_percentage_average.sql"), "utf8");
const code = sql.replace(/^--.*$/gm, "");

describe("class_rankings percentage average migration", () => {
  it("changes only the ranking function (plus a column comment): no tables, no data writes, nothing dropped", () => {
    expect(code).not.toMatch(/create\s+table|alter\s+table|drop\s+|update\s+public\.|truncate/i);
    expect([...code.matchAll(/create or replace function\s+([\w.]+)/gi)].map((m) => m[1])).toEqual(["public.recompute_class_rankings"]);
    // The only statements touching class_rankings rows are the function's own delete+insert for one exam.
    expect(code).toMatch(/delete from public\.class_rankings where exam_id = p_exam_id/);
  });

  it("averages each score as a percentage of its subject's maximum", () => {
    expect(code).toMatch(/avg\(m\.raw_score \* 100\.0 \/ es\.max_score\)/);
    expect(code).toMatch(/join public\.exam_subjects es\s+on es\.exam_id = m\.exam_id and es\.class_id = m\.class_id and es\.subject_id = m\.subject_id/);
  });

  it("keeps total as raw marks and ranks by the unrounded mean with rank() so ties share a position", () => {
    expect(code).toMatch(/sum\(m\.raw_score\)/);
    expect(code).toMatch(/rank\(\) over \(partition by st\.current_class_id order by avg\(m\.raw_score \* 100\.0 \/ es\.max_score\) desc\)/);
    expect(code).toMatch(/rank\(\) over \(partition by m\.class_id order by avg\(m\.raw_score \* 100\.0 \/ es\.max_score\) desc\)/);
  });

  it("never treats a missing mark as zero and cannot divide by a zero maximum", () => {
    expect(code).toMatch(/m\.raw_score is not null/);
    expect(code).toMatch(/es\.max_score > 0/);
  });

  it("stays a locked-down SECURITY DEFINER function with its grants revoked", () => {
    expect(code).toMatch(/security definer\s+set search_path to 'public'/);
    expect(code).toMatch(/revoke all on function public\.recompute_class_rankings\(uuid\) from public, anon, authenticated/);
  });

  it("leaves the callers alone (close_exam and the post-close correction trigger are not redefined)", () => {
    expect(code).not.toMatch(/close_exam|marks_recompute_rankings_on_correction/);
  });
});
