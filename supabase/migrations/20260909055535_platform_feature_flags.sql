-- Feature flags per school: "useful once you want to beta-test something (like the CBC/KNEC
-- work) on one or two schools before rolling out platform-wide, rather than shipping to
-- everyone at once." This is deliberately just the registry + per-school override
-- infrastructure -- no existing shipped feature (KNEC export, competency analytics, etc.) is
-- being retrofitted to read these flags in this migration; that would be a separate, scoped
-- change per feature once there's an actual beta candidate. A flag with no code checking it
-- yet is inert by design, not a bug.
--
-- Two tables rather than one boolean column bag: platform_feature_flags is the catalog (what
-- flags exist at all, defined once by the platform admin), school_feature_flags is the
-- per-school override (defaults to "not enabled" for a school with no row -- absence means
-- off, same "no row = no entitlement" convention as whitelabel_enabled defaulting false).

create table public.platform_feature_flags (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  label text not null,
  description text,
  created_at timestamptz not null default now(),
  created_by uuid
);

-- Case-insensitive uniqueness on key -- these are used as stable lookup identifiers by future
-- app code (school_has_feature_flag below), so "cbc_pilot" and "CBC_Pilot" coexisting would be
-- a foot-gun no UI validation fully prevents.
create unique index platform_feature_flags_key_unique on public.platform_feature_flags (lower(key));

create table public.school_feature_flags (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  flag_id uuid not null references public.platform_feature_flags(id) on delete cascade,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (school_id, flag_id)
);

create index idx_school_feature_flags_school on public.school_feature_flags (school_id);

alter table public.platform_feature_flags enable row level security;
alter table public.school_feature_flags enable row level security;

-- Catalog is readable by any authenticated user (harmless metadata: flag keys/labels, not
-- which schools have them) so a school's own app code can look up a flag by key later without
-- needing super_admin. Only super_admin can define new flags.
create policy platform_feature_flags_select on public.platform_feature_flags
  for select using (true);
create policy platform_feature_flags_insert on public.platform_feature_flags
  for insert with check (auth_is_super_admin());
create policy platform_feature_flags_delete on public.platform_feature_flags
  for delete using (auth_is_super_admin());

-- Per-school rows: super_admin manages every school's flags from the admin console; a school's
-- own users can read (not write) only their own school's rows, so a future in-app feature check
-- (e.g. "is the CBC pilot on for us?") can query this directly under normal RLS.
create policy school_feature_flags_select on public.school_feature_flags
  for select using (auth_is_super_admin() or school_id = auth_school_id());
create policy school_feature_flags_insert on public.school_feature_flags
  for insert with check (auth_is_super_admin());
create policy school_feature_flags_update on public.school_feature_flags
  for update using (auth_is_super_admin()) with check (auth_is_super_admin());
create policy school_feature_flags_delete on public.school_feature_flags
  for delete using (auth_is_super_admin());

revoke all on public.platform_feature_flags, public.school_feature_flags from public, anon;
grant select, insert, delete on public.platform_feature_flags to authenticated;
grant select, insert, update, delete on public.school_feature_flags to authenticated;

-- Convenience lookup for future app-code gating (e.g. `if (await schoolHasFeatureFlag(schoolId,
-- 'cbc_pilot'))`) -- absence of both a school_feature_flags row and a matching catalog key
-- both read as "off", never an error, so a typo'd flag key fails safe rather than throwing.
create or replace function public.school_has_feature_flag(p_school_id uuid, p_key text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (
      select sff.enabled
      from public.school_feature_flags sff
      join public.platform_feature_flags pff on pff.id = sff.flag_id
      where sff.school_id = p_school_id and lower(pff.key) = lower(p_key)
    ),
    false
  );
$$;
revoke all on function public.school_has_feature_flag(uuid, text) from public;
grant execute on function public.school_has_feature_flag(uuid, text) to authenticated;
