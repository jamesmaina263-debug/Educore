-- Full-migration RLS re-audit (remaining item from the production readiness audit): parsed all
-- 359 prior migrations for every CREATE POLICY / ALTER TABLE ... ROW LEVEL SECURITY statement and
-- cross-checked every table against its tenant-isolation predicate. One inconsistency found —
-- everything else checked out (see the audit report for the full method and the ~35 policies that
-- were manually re-verified because they don't reference school_id/auth_school_id directly).
--
-- risk_model_versions (predictive_risk_scoring_phase30_item1) is the one table created without
-- ever having RLS enabled. Not a tenant-isolation bug — the table has no school_id column at all
-- (it's a single shared scoring-methodology config: one row per model version, weights used
-- platform-wide by recompute_student_risk_scores(), not per-school data) — the actual per-student
-- output, student_risk_scores, already has RLS enabled with a correct school_id = auth_school_id()
-- policy. But every other genuinely-global reference table in this schema (subscription_plans,
-- subject_catalogue) enables RLS anyway with an explicit `using (true)` policy, both so intent is
-- checkable in one place instead of relying on GRANT alone, and so a future Postgres/Supabase
-- default-deny-without-policy change can't silently start blocking a table nobody remembers to
-- check. This brings risk_model_versions in line with that convention.
alter table public.risk_model_versions enable row level security;

create policy risk_model_versions_select on public.risk_model_versions
  for select to authenticated using (true);
