-- Staff forced password-change on first login + temp-password expiry.
--
-- Gap: inviteStaffMember() (Settings > Add staff) generates a temporary
-- password shown once to the inviting admin, but nothing ever forced the
-- new staff member to change it, and it never expired. A temp password
-- relayed over Slack/WhatsApp/in person by the admin was effectively a
-- permanent password unless the staff member happened to change it
-- themselves later.

alter table school_users
  add column must_change_password boolean not null default false,
  add column temp_password_expires_at timestamptz,
  add column password_changed_at timestamptz;

comment on column school_users.must_change_password is
  'True right after an admin invite (or a password reset) until the user sets their own password via /change-password. Enforced by the login action and by middleware for every protected route.';
comment on column school_users.temp_password_expires_at is
  'If must_change_password is still true after this time, the temp password is treated as expired: login succeeds against Supabase Auth but the app immediately signs the session back out and tells the user to ask an admin to reset their password.';

-- Guard the two new gating columns the same way role_id/school_id/status
-- are already guarded: a non-privileged user updating their own row can't
-- just flip must_change_password/temp_password_expires_at off directly.
-- The only legitimate way to clear them is the change-password server
-- action, which does so via the service-role client *after* confirming
-- supabase.auth.updateUser() actually succeeded -- auth.uid() is null for
-- service-role calls (no user JWT), so they're recognized as trusted here,
-- consistent with the service role already bypassing RLS entirely.
create or replace function prevent_school_user_privilege_escalation()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_caller_is_super_admin boolean;
  v_caller_has_staff_manage boolean;
  v_caller_id uuid := auth.uid();
begin
  if v_caller_id is null then
    -- Service-role (admin) client: no user JWT, already bypasses RLS.
    return new;
  end if;

  select exists (
    select 1 from school_users su join roles r on r.id = su.role_id
    where su.auth_user_id = v_caller_id and su.status = 'active' and r.name = 'super_admin'
  ) into v_caller_is_super_admin;

  if v_caller_is_super_admin then
    return new;
  end if;

  select public.auth_has_permission('staff.manage') into v_caller_has_staff_manage;

  if v_caller_has_staff_manage then
    return new;
  end if;

  if new.role_id is distinct from old.role_id
     or new.school_id is distinct from old.school_id
     or new.status is distinct from old.status
     or new.must_change_password is distinct from old.must_change_password
     or new.temp_password_expires_at is distinct from old.temp_password_expires_at then
    raise exception 'insufficient privileges to change role_id, school_id, status, or password-gating fields';
  end if;

  return new;
end;
$$;
