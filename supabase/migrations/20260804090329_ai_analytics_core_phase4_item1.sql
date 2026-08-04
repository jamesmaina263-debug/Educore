-- Phase 4, Item 1: Natural-language analytics ("Ask Trimora AI")
-- Classify-then-execute pattern, NOT text-to-SQL: Gemini only classifies the question into one of
-- a fixed set of pre-defined, parameterized read intents; the actual data retrieval is done by
-- ordinary RLS-respecting queries run as the caller. This avoids the injection/data-exfiltration
-- risk of letting an LLM generate arbitrary SQL against a multi-tenant database.
--
-- Scope decision (judgment call, documented like the Phase 3 Inventory roles-matrix gap):
-- ai.read is Owner + Principal only, not Deputy — mirrors the dashboard wireframe (Part S.3),
-- which shows the AI-flagged at-risk widget for Owner/Principal only, and mirrors Finance's
-- existing exclusion of Deputy Principal (§8: Deputy Finance = none) since AI answers can surface
-- financial figures (fee collection, balances) that Deputy is otherwise barred from.

create table public.ai_query_logs (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  asked_by uuid not null references public.school_users(id),
  question_text text not null,
  matched_intent text,
  answer_text text,
  created_at timestamptz not null default now()
);
comment on table public.ai_query_logs is
  'Audit trail of every natural-language question asked of Trimora AI and which fixed intent it was classified into. matched_intent is null if classification failed (answer_text then explains why, never a guess).';

alter table public.ai_query_logs enable row level security;

create policy ai_query_logs_select on public.ai_query_logs
  for select using (school_id = auth_school_id() and auth_has_permission('ai.read'));

create policy ai_query_logs_insert on public.ai_query_logs
  for insert with check (school_id = auth_school_id() and auth_has_permission('ai.read'));

-- No update/delete policy: immutable log, same convention as teacher_performance_reviews.

revoke all on public.ai_query_logs from public, anon;
grant select, insert on public.ai_query_logs to authenticated;

-- Permission seeding (platform-wide defaults, school_id null — same convention as every prior module)
insert into public.role_permissions (role_id, school_id, permission_key, allowed)
select r.id, null, perm.key, true
from roles r
cross join (values ('ai.read'), ('reports.read')) as perm(key)
where r.name in ('school_owner', 'principal');
