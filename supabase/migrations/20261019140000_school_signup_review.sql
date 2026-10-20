-- Manual approval of self-signup schools.
--
-- A new self-signup still gets its trial immediately, but the app can hold it on a "waiting for approval"
-- page until a platform admin approves it (the app change ships separately, AFTER this migration is live).
--
-- Also in this migration:
--   * Approving a school restarts its 30-day trial from that moment (a slow approval must not eat the trial).
--   * A new self-signup (its owner row being created while the school is 'pending') raises a bell notification
--     and an email to the platform admin, using the same pg_net -> notify-platform-admin pattern as demo requests.
--
-- Safety posture:
--   * Additive and safe to run twice. Every EXISTING school (including live tenants) gets 'approved' from the
--     column default, so nothing changes for anyone today. Only code that explicitly writes 'pending' (the
--     signup action) creates a school that waits.
--   * A school owner can update their own school row (RLS schools_update), so the new columns are guarded by a
--     trigger: only a super admin or the service role may change them. Without it a pending owner could
--     approve themselves from the browser.
--   * The admin RPC only moves a school that is currently 'pending' or 'rejected'. It cannot touch an
--     already-approved school, so a stray click can never lock a live school out.

-- ============================================================
-- 1. Columns
-- ============================================================
alter table public.schools
  add column if not exists signup_review_status text not null default 'approved',
  add column if not exists signup_reviewed_at timestamptz,
  add column if not exists signup_reviewed_by uuid references auth.users(id) on delete set null;

alter table public.schools drop constraint if exists schools_signup_review_status_check;
alter table public.schools
  add constraint schools_signup_review_status_check
  check (signup_review_status in ('pending', 'approved', 'rejected'));

create index if not exists idx_schools_signup_review_pending
  on public.schools (created_at desc)
  where signup_review_status <> 'approved';

-- ============================================================
-- 2. Guard: only platform staff / the service role may change the review fields
-- ============================================================
create or replace function public.protect_schools_signup_review()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth_is_super_admin() or auth.role() = 'service_role' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.signup_review_status is distinct from old.signup_review_status
       or new.signup_reviewed_at is distinct from old.signup_reviewed_at
       or new.signup_reviewed_by is distinct from old.signup_reviewed_by then
      raise exception 'Only platform staff can change a school''s signup approval.';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.protect_schools_signup_review() from public, anon, authenticated;

drop trigger if exists trg_schools_protect_signup_review on public.schools;
create trigger trg_schools_protect_signup_review
  before update on public.schools
  for each row execute function public.protect_schools_signup_review();

-- ============================================================
-- 3. Admin decision (approve / reject). Only for a school that is waiting or was rejected.
-- ============================================================
create or replace function public.admin_review_school_signup(p_school_id uuid, p_decision text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to review school signups.';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected.';
  end if;

  update public.schools
     set signup_review_status = p_decision,
         signup_reviewed_at = now(),
         signup_reviewed_by = auth.uid()
   where id = p_school_id
     and signup_review_status in ('pending', 'rejected');

  if not found then
    raise exception 'That school was not found, or it is not a signup waiting for review.';
  end if;

  -- The trial clock starts when the school is approved, not when it signed up.
  if p_decision = 'approved' then
    update public.school_subscriptions
       set trial_ends_at = now() + make_interval(days => 30),
           updated_at = now()
     where school_id = p_school_id
       and status = 'trialing';
  end if;
end;
$$;

revoke all on function public.admin_review_school_signup(uuid, text) from public, anon;
grant execute on function public.admin_review_school_signup(uuid, text) to authenticated;

-- ============================================================
-- 4. Tell the platform admin about a new signup waiting for approval (bell + email)
-- ============================================================
alter table public.platform_notifications drop constraint if exists platform_notifications_kind_check;
alter table public.platform_notifications
  add constraint platform_notifications_kind_check
  check (kind in ('demo_request', 'lead_magnet', 'demo_partial_lead', 'email_unsubscribe', 'school_signup'));

-- Fires when the OWNER row of a still-pending school is created (the school row exists first, then its owner).
-- Staff the owner adds later, and schools created any other way (default 'approved'), never trigger it.
-- It must never break signup, so any failure here is swallowed with a warning.
create or replace function public.notify_admin_new_school_signup()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school record;
  v_is_owner boolean;
  v_webhook_secret text;
  v_project_url text := 'https://alzqlvfaftwegptfbfej.supabase.co';
begin
  begin
    select s.id, s.name, s.school_type, s.institution_type, s.signup_review_status
      into v_school
      from public.schools s
     where s.id = new.school_id;

    if v_school.signup_review_status is distinct from 'pending' then
      return new;
    end if;

    select exists (select 1 from public.roles r where r.id = new.role_id and r.name = 'school_owner')
      into v_is_owner;
    if not v_is_owner then
      return new;
    end if;

    insert into public.platform_notifications (kind, title, body, action_path, related_table, related_id)
    values (
      'school_signup',
      'New school signup awaiting approval',
      v_school.name || ' (' || coalesce(nullif(btrim(new.full_name), ''), 'owner') || ') signed up and is waiting for your approval.',
      '/admin/signups',
      'schools',
      v_school.id
    );
  exception when others then
    raise warning 'notify_admin_new_school_signup (bell) failed: %', sqlerrm;
    return new;
  end;

  -- Separate block: if the email call fails, the bell notification above must still stand.
  begin
    select decrypted_secret into v_webhook_secret
      from vault.decrypted_secrets
     where name = 'platform_notification_webhook_secret';

    perform net.http_post(
      url := v_project_url || '/functions/v1/notify-platform-admin',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-webhook-secret', coalesce(v_webhook_secret, '')
      ),
      body := jsonb_build_object(
        'kind', 'school_signup',
        'school_name', v_school.name,
        'name', new.full_name,
        'email', new.email,
        'phone', new.phone,
        'school_type', coalesce(v_school.institution_type, v_school.school_type)
      )
    );
  exception when others then
    raise warning 'notify_admin_new_school_signup (email) failed: %', sqlerrm;
  end;

  return new;
end;
$$;

revoke all on function public.notify_admin_new_school_signup() from public, anon, authenticated;

drop trigger if exists trg_notify_admin_new_school_signup on public.school_users;
create trigger trg_notify_admin_new_school_signup
  after insert on public.school_users
  for each row execute function public.notify_admin_new_school_signup();
