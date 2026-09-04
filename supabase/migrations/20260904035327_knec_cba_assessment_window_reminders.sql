-- CBA assessment-window reminders (Phase 7 of the current build order).
--
-- KNEC publishes its own Competency-Based Assessment windows (e.g. "Grade 4/5 Term 3 CBA
-- uploads due Oct 23") via circulars/portal notices -- not something KICD/KNEC licenses, just
-- an operational date a school needs to hit. This is pure EduCore-authored operational data:
-- platform staff enter known windows as KNEC publishes them (via /admin/cba-windows), and every
-- school automatically sees the ones relevant to them as an in-app reminder in
-- Integrations > KNEC CBA. No licensing concern, no dependency on the still-unknown KNEC upload
-- template (Phase 5), no blocker.
--
-- Deliberately NOT a scheduled/cron feature: the "reminder" is a live, computed view (upcoming,
-- non-dismissed windows relevant to this school), not a batch job that drafts rows on a
-- schedule. Simpler, always up to date, and avoids adding another Vercel Cron endpoint for
-- something that doesn't need one.

-- ============================================================
-- knec_cba_assessment_windows: global reference data, one row per KNEC-published assessment
-- window. Maintained by platform staff (super_admin only) via /admin/cba-windows -- same shape
-- as other EduCore-authored reference lists, not something an individual school edits.
-- ============================================================
create table public.knec_cba_assessment_windows (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  -- Which grades this window applies to, e.g. {'Grade 4','Grade 5'} -- matched loosely against
  -- a school's own classes.name (free text, no canonical grade-number column -- same convention
  -- used by the pathway-guidance default-class heuristic). Null/empty = applies to every grade.
  grade_labels text[],
  opens_at date,
  closes_at date not null,
  notes text,
  -- Link to the actual KNEC circular/portal notice this window is sourced from, so a school can
  -- go verify it themselves rather than just trusting EduCore's transcription.
  source_url text,
  is_active boolean not null default true,
  created_by uuid not null references public.school_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.knec_cba_assessment_windows is
  'Platform-maintained (super_admin only) reference list of KNEC-published CBA/SBA assessment windows -- EduCore-authored operational data, not licensed KICD/KNEC content. Surfaced to every school as an in-app reminder in Integrations > KNEC CBA (see knec_cba_window_dismissals for per-school dismiss state). Managed at /admin/cba-windows.';

create index idx_knec_cba_assessment_windows_closes_at on public.knec_cba_assessment_windows(closes_at) where is_active;

create trigger trg_knec_cba_assessment_windows_updated_at
  before update on public.knec_cba_assessment_windows
  for each row execute function public.set_updated_at();

-- Deliberately NO audit_row_change() trigger here: that function unconditionally reads
-- NEW.school_id/OLD.school_id (see 20260812150000_phase17_audit_logging_system_wide.sql) to
-- decide which school's audit log to file the entry against, and this table has no school_id
-- column at all -- it's global platform reference data, not scoped to any one school. Calling
-- it here would raise "record has no field school_id" on every insert/update/delete. There's
-- also no school-specific audit_log to attribute a platform-wide calendar edit to; RLS
-- (super_admin-only writes, defined below) is this table's protection layer instead, same
-- reasoning the codebase already applies to platform-level tables like school_groups.

alter table public.knec_cba_assessment_windows enable row level security;

-- Any authenticated school user can see active windows (this is what every school's reminder
-- panel reads); only super_admin sees inactive ones (soft-deleted/retired) or can write.
create policy knec_cba_assessment_windows_select on public.knec_cba_assessment_windows
for select
using (public.auth_is_super_admin() or is_active);

create policy knec_cba_assessment_windows_insert on public.knec_cba_assessment_windows
for insert
with check (public.auth_is_super_admin());

create policy knec_cba_assessment_windows_update on public.knec_cba_assessment_windows
for update
using (public.auth_is_super_admin())
with check (public.auth_is_super_admin());

create policy knec_cba_assessment_windows_delete on public.knec_cba_assessment_windows
for delete
using (public.auth_is_super_admin());

-- ============================================================
-- Per-school opt-out. Default on -- a school that's already using the KNEC CBA export almost
-- certainly wants the deadline reminder too; this is just an escape hatch.
-- ============================================================
alter table public.schools
  add column knec_cba_reminders_enabled boolean not null default true;

comment on column public.schools.knec_cba_reminders_enabled is
  'Whether Integrations > KNEC CBA shows the upcoming-assessment-window reminder panel for this school. Default on. Set via set_knec_cba_reminders_enabled().';

create or replace function public.set_knec_cba_reminders_enabled(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_school_id uuid;
begin
  if not public.auth_has_permission('knec.manage') then
    raise exception 'Not authorized to change KNEC CBA reminder settings.';
  end if;
  v_school_id := public.auth_school_id();

  update public.schools
  set knec_cba_reminders_enabled = p_enabled
  where id = v_school_id;
end;
$function$;
revoke all on function public.set_knec_cba_reminders_enabled(boolean) from public;
grant execute on function public.set_knec_cba_reminders_enabled(boolean) to authenticated;

-- ============================================================
-- knec_cba_window_dismissals: per-school "I've seen/handled this one" state, so a reminder a
-- school has already acted on doesn't keep resurfacing. One row = this school no longer wants
-- to see this window in its reminder panel; there is no "undismiss" in v1 (a school that
-- changes its mind can still see the window's real deadline on the KNEC portal itself).
-- ============================================================
create table public.knec_cba_window_dismissals (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  window_id uuid not null references public.knec_cba_assessment_windows(id) on delete cascade,
  dismissed_by uuid not null references public.school_users(id),
  dismissed_at timestamptz not null default now(),
  unique (school_id, window_id)
);
comment on table public.knec_cba_window_dismissals is
  'Per-school dismissal of a knec_cba_assessment_windows reminder. Written only by dismiss_knec_cba_window_reminder().';

create index idx_knec_cba_window_dismissals_school_id on public.knec_cba_window_dismissals(school_id);

alter table public.knec_cba_window_dismissals enable row level security;

create policy knec_cba_window_dismissals_select on public.knec_cba_window_dismissals
for select
using (
  public.auth_is_super_admin()
  or (school_id = public.auth_school_id() and public.auth_has_permission('knec.manage'))
);
-- No insert/update/delete policy for regular users -- the function below is the only write path.

create or replace function public.dismiss_knec_cba_window_reminder(p_window_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_school_id uuid;
  v_actor uuid;
begin
  if not public.auth_has_permission('knec.manage') then
    raise exception 'Not authorized to dismiss KNEC CBA reminders.';
  end if;

  v_school_id := public.auth_school_id();
  select su.id into v_actor from public.school_users su
    where su.auth_user_id = auth.uid() and su.status = 'active';
  if v_actor is null then
    raise exception 'No active school user for the current session.';
  end if;

  if not exists (select 1 from public.knec_cba_assessment_windows where id = p_window_id) then
    raise exception 'Assessment window not found.';
  end if;

  insert into public.knec_cba_window_dismissals (school_id, window_id, dismissed_by)
  values (v_school_id, p_window_id, v_actor)
  on conflict (school_id, window_id) do nothing;
end;
$function$;
revoke all on function public.dismiss_knec_cba_window_reminder(uuid) from public;
grant execute on function public.dismiss_knec_cba_window_reminder(uuid) to authenticated;
