import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Guards the safety properties of the report settings migration. Its behaviour (permission check,
// key/type validation, caller's-school-only write) was proven against a real Postgres engine when
// it was written; these checks stop a later edit silently removing those properties.
const sql = readFileSync(path.resolve(__dirname, "../../supabase/migrations/20261019093000_school_report_settings.sql"), "utf8");
const code = sql.replace(/^--.*$/gm, "");

describe("school report settings migration", () => {
  it("is additive: one nullable column on schools and one function, nothing dropped or rewritten", () => {
    expect(code).toMatch(/alter table public\.schools add column report_settings jsonb;/);
    // Nullable with no default: NULL means "use the code defaults", so existing schools are untouched.
    expect(code).not.toMatch(/add column report_settings jsonb\s+(not null|default)/i);
    expect(code).not.toMatch(/drop\s+|create\s+table|update\s+public\.(?!schools)|truncate|delete\s+from/i);
    expect([...code.matchAll(/create or replace function\s+([\w.]+)/gi)].map((m) => m[1])).toEqual(["public.update_report_settings"]);
  });
  it("requires exams.write, validates keys and types, and writes only the caller's school", () => {
    expect(code).toMatch(/auth_has_permission\('exams\.write'\)/);
    expect(code).toMatch(/jsonb_typeof\(p_settings\) is distinct from 'object'/);
    expect(code).toMatch(/Unknown report setting/);
    expect(code).toMatch(/jsonb_typeof\(p_settings -> v_key\) is distinct from 'boolean'/);
    expect(code).toMatch(/v_school_id := public\.auth_school_id\(\)/);
    expect(code).toMatch(/update public\.schools set report_settings = p_settings where id = v_school_id/);
  });
  it("is SECURITY DEFINER with a fixed search_path and no anon/public execute", () => {
    expect(code).toMatch(/security definer\s+set search_path to 'public'/);
    expect(code).toMatch(/revoke all on function public\.update_report_settings\(jsonb\) from public, anon;/);
    expect(code).toMatch(/grant execute on function public\.update_report_settings\(jsonb\) to authenticated;/);
  });
  it("does not touch ranking computation (display-level switch only)", () => {
    expect(code).not.toMatch(/recompute_class_rankings|close_exam|class_rankings/);
  });
});
