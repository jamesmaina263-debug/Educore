-- Phase 5 Item 3: Third-party API access.
--
-- Design decision (documented, real scope limit like Phase 4 Item 1's fixed-intent list):
-- v1 is READ-ONLY. No write scopes exist yet -- a third party breaking a school's own data via
-- an API integration is a much worse failure mode than a third party not being able to write
-- at all, and read-only is enough for the obvious first use cases (a parent app, an SMS
-- gateway partner, a Ministry of Education reporting feed).
--
-- Design decision: this does NOT expose PostgREST/raw tables to API-key holders. An API key
-- is not a Postgres role and has no JWT -- there is no clean way to make PostgREST's RLS
-- recognize it without a much bigger auth-architecture change. Instead, matching the existing
-- "classify-then-execute, nothing un-grounded reaches the caller" convention from Trimora AI
-- (Phase 4 Item 1), an api-v1 Edge Function (not built this session -- flagged below) will
-- authenticate the key, resolve its scope, and run one of a small fixed set of parameterized
-- queries -- never pass-through SQL. The DB layer below (keys, scopes, audit log, verification
-- function) is what that Edge Function will call.
--
-- Design decision: sensitive tables are denylisted from ever being an available scope --
-- medical_records, teacher_performance_reviews, payroll_records, documents -- same tiering the
-- blueprint already applies to Deputy Principal/Bursar internally (Part D / Phase 4 Item 1).

create or replace function public.array_all_read_scopes(p_scopes text[])
returns boolean
language sql
immutable
as $function$
  select coalesce(bool_and(s like '%.read'), true) from unnest(p_scopes) s
$function$;

create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools(id),
  school_group_id uuid references public.school_groups(id),
  name text not null,
  key_prefix text not null unique,
  key_hash text not null,
  scopes text[] not null default '{}',
  status text not null default 'active' check (status in ('active','revoked')),
  created_by uuid not null references public.school_users(id),
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references public.school_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint api_keys_exactly_one_scope_owner check (
    (school_id is not null and school_group_id is null) or
    (school_id is null and school_group_id is not null)
  ),
  constraint api_keys_scopes_are_read_only check (public.array_all_read_scopes(scopes))
);
comment on table public.api_keys is
  'Third-party API credentials, scoped to exactly one school OR one school_group (never both, never platform-wide). Read-only in v1 -- enforced both by the check constraint and by the fixed set of scopes the (not-yet-built) api-v1 Edge Function recognizes. key_hash is sha256 of the actual secret; the secret itself is shown once at creation time and never stored.';

create table public.api_request_logs (
  id uuid primary key default gen_random_uuid(),
  api_key_id uuid not null references public.api_keys(id),
  endpoint text not null,
  status_code integer not null,
  ip_address text,
  requested_at timestamptz not null default now()
);
comment on table public.api_request_logs is
  'Immutable audit trail of every third-party API call, same no-delete/update convention as ai_query_logs/student_promotion_history -- without this you cannot answer "who pulled this data and when" for a KDPA inquiry.';

alter table public.api_keys enable row level security;
alter table public.api_request_logs enable row level security;

insert into public.role_permissions (role_id, school_id, permission_key, allowed)
select r.id, null, 'api.manage', true
from public.roles r
where r.name in ('school_owner','group_admin')
on conflict do nothing;

create policy api_keys_select on public.api_keys
for select
using (
  public.auth_is_super_admin()
  or (school_id = public.auth_school_id() and public.auth_has_permission('api.manage'))
  or (school_group_id = public.auth_group_id() and public.auth_has_permission('api.manage'))
);

create policy api_keys_insert on public.api_keys
for insert
with check (
  (school_id = public.auth_school_id() and school_group_id is null and public.auth_has_permission('api.manage'))
  or (school_group_id = public.auth_group_id() and school_id is null and public.auth_has_permission('api.manage'))
);

-- Update is restricted in practice to revocation (status/revoked_at/revoked_by) -- enforced
-- at the application layer for now, same as other "narrow update in practice" tables; RLS
-- gates it to the same owner/group_admin scope.
create policy api_keys_update on public.api_keys
for update
using (
  (school_id = public.auth_school_id() and public.auth_has_permission('api.manage'))
  or (school_group_id = public.auth_group_id() and public.auth_has_permission('api.manage'))
)
with check (
  (school_id = public.auth_school_id() and public.auth_has_permission('api.manage'))
  or (school_group_id = public.auth_group_id() and public.auth_has_permission('api.manage'))
);

-- No delete policy at all -- keys are revoked, never deleted, so the audit trail in
-- api_request_logs always resolves to a real key row. Same convention as teacher_performance_reviews.

create policy api_request_logs_select on public.api_request_logs
for select
using (
  public.auth_is_super_admin()
  or exists (
    select 1 from api_keys k
    where k.id = api_request_logs.api_key_id
      and (
        (k.school_id = public.auth_school_id() and public.auth_has_permission('api.manage'))
        or (k.school_group_id = public.auth_group_id() and public.auth_has_permission('api.manage'))
      )
  )
);
-- No insert/update/delete policy for regular users -- only the (not-yet-built) Edge Function,
-- running as service_role, writes request logs. service_role bypasses RLS by default.

-- Key issuance: generates the raw secret (returned once, never stored) and stores only its
-- hash + a short prefix for display ("tk_live_ab12...") -- same "never store plaintext"
-- principle as OTP codes.
--
-- NOTE: this original version had a search_path bug (gen_random_bytes/digest live in the
-- extensions schema); fixed in fix_issue_api_key_search_path_phase5_item3.sql. Kept as
-- originally applied for an accurate migration history.
create or replace function public.issue_api_key(
  p_name text,
  p_scopes text[],
  p_school_id uuid default null,
  p_school_group_id uuid default null,
  p_expires_at timestamptz default null
)
returns table (id uuid, raw_key text, key_prefix text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller_su uuid;
  v_secret text := encode(gen_random_bytes(24), 'hex');
  v_prefix text := 'tk_' || substr(encode(gen_random_bytes(4), 'hex'), 1, 8);
  v_id uuid;
begin
  select su.id into v_caller_su
  from school_users su
  where su.auth_user_id = auth.uid() and su.status = 'active';

  if v_caller_su is null or not public.auth_has_permission('api.manage') then
    raise exception 'insufficient privileges to issue an API key';
  end if;

  if (p_school_id is null) = (p_school_group_id is null) then
    raise exception 'exactly one of p_school_id or p_school_group_id must be set';
  end if;

  if p_school_id is not null and p_school_id is distinct from public.auth_school_id() then
    raise exception 'cannot issue a key for a school outside your own scope';
  end if;
  if p_school_group_id is not null and p_school_group_id is distinct from public.auth_group_id() then
    raise exception 'cannot issue a key for a group outside your own scope';
  end if;

  insert into api_keys (school_id, school_group_id, name, key_prefix, key_hash, scopes, created_by, expires_at)
  values (p_school_id, p_school_group_id, p_name, v_prefix, encode(digest(v_secret, 'sha256'), 'hex'), p_scopes, v_caller_su, p_expires_at)
  returning api_keys.id into v_id;

  return query select v_id, (v_prefix || '.' || v_secret), v_prefix;
end;
$function$;

-- NOTE: original grant here was later tightened by phase5_advisor_fixes.sql (revoked from
-- anon/public, granted to authenticated only) -- see that later file for the fix.
grant execute on function public.issue_api_key(text, text[], uuid, uuid, timestamptz) to authenticated;
