-- Phase 7.3 (1/2): staff training records + contract/credential expiry roll-up. Additive only; ships dark.
--
-- * New flag feature.hr.staff_training (catalog entry, enabled for nobody).
-- * New table staff_training_records (CPD, induction, safeguarding, first aid, ...). Distinct from
--   staff_qualifications, which keeps holding credentials; nothing is copied or moved between them.
-- * Reads: staff.read in the caller's own school plus the flag, or the staff member's own records (flag on).
--   Writes: no direct write policies; every change goes through save_staff_training_record() /
--   cancel_staff_training_record(), which require staff.manage, the flag and same-school ownership.
-- * staff_expiry_overview(): READ-ONLY roll-up of contracts ending (school_users.contract_end_date),
--   qualifications expiring (staff_qualifications.expiry_date) and training expiring, for staff.read holders.
--   It changes nothing and does not renew anything: renewing a contract stays the existing employment-tab edit.
-- * Nothing existing is touched: school_users, staff_qualifications, documents, payroll and every existing
--   function, policy, trigger and grant are unchanged. Nothing here sends a message or touches pay.
-- Rollback: switch the flag off (reads return nothing, functions refuse). Nothing else depends on these objects.

-- 1. Flag catalog entry.
insert into public.platform_feature_flags (key, label, description)
select 'feature.hr.staff_training',
       'Staff training records and expiry roll-up',
       'Training/CPD records per staff member and a roll-up of expiring contracts, qualifications and training. Records only; sends nothing. Off by default.'
where not exists (
  select 1 from public.platform_feature_flags where lower(key) = 'feature.hr.staff_training'
);

-- 2. Training records.
create table if not exists public.staff_training_records (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  staff_id uuid not null references public.school_users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 150),
  provider text check (provider is null or char_length(provider) <= 150),
  category text not null default 'cpd'
    check (category in ('cpd', 'induction', 'safeguarding', 'first_aid', 'subject', 'leadership', 'compliance', 'other')),
  status text not null default 'planned' check (status in ('planned', 'completed', 'cancelled')),
  start_date date not null,
  end_date date,
  hours numeric(5, 1) check (hours is null or (hours >= 0 and hours <= 1000)),
  expires_on date,
  certificate_document_id uuid references public.documents(id) on delete set null,
  notes text check (notes is null or char_length(notes) <= 1000),
  created_by uuid references public.school_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_training_dates_ok check (end_date is null or end_date >= start_date),
  constraint staff_training_expiry_ok check (expires_on is null or expires_on >= start_date)
);
comment on table public.staff_training_records is
  'Staff training/CPD. Never deleted: cancel_staff_training_record() sets status = cancelled. Written only by save_staff_training_record() / cancel_staff_training_record().';
create index if not exists staff_training_records_school_staff on public.staff_training_records (school_id, staff_id);
create index if not exists staff_training_records_expiry on public.staff_training_records (school_id, expires_on) where expires_on is not null;
create index if not exists staff_training_records_certificate on public.staff_training_records (certificate_document_id) where certificate_document_id is not null;
alter table public.staff_training_records enable row level security;
drop policy if exists staff_training_records_select on public.staff_training_records;
create policy staff_training_records_select on public.staff_training_records for select
  using (
    auth_is_super_admin()
    or (
      school_id = auth_school_id()
      and public.my_school_has_feature_flag('feature.hr.staff_training')
      and (
        auth_has_permission('staff.read')
        or staff_id = (select id from public.school_users where auth_user_id = auth.uid() and status = 'active')
      )
    )
  );

-- 3. Save a training record (create when p_id is null).
create or replace function public.save_staff_training_record(
  p_id uuid,
  p_staff_id uuid,
  p_title text,
  p_provider text,
  p_category text,
  p_status text,
  p_start_date date,
  p_end_date date,
  p_hours numeric,
  p_expires_on date,
  p_certificate_document_id uuid,
  p_notes text
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := auth_school_id();
  v_id uuid;
begin
  if v_school is null or not auth_has_permission('staff.manage') then
    raise exception 'Not authorized to manage staff training.' using errcode = '42501';
  end if;
  if not public.school_has_feature_flag(v_school, 'feature.hr.staff_training') then
    raise exception 'Staff training records are not enabled for this school.' using errcode = '55000';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 150
     or p_category is null or p_category not in ('cpd', 'induction', 'safeguarding', 'first_aid', 'subject', 'leadership', 'compliance', 'other')
     or p_status is null or p_status not in ('planned', 'completed')
     or p_start_date is null
     or (p_end_date is not null and p_end_date < p_start_date)
     or (p_expires_on is not null and p_expires_on < p_start_date)
     or (p_hours is not null and (p_hours < 0 or p_hours > 1000))
     or (p_provider is not null and char_length(p_provider) > 150)
     or (p_notes is not null and char_length(p_notes) > 1000) then
    raise exception 'Invalid training details.' using errcode = '22023';
  end if;
  if p_staff_id is null or not exists (
    select 1 from public.school_users where id = p_staff_id and school_id = v_school
  ) then
    raise exception 'Staff member not found.' using errcode = 'P0002';
  end if;
  if p_certificate_document_id is not null and not exists (
    select 1 from public.documents where id = p_certificate_document_id and school_id = v_school and staff_id = p_staff_id
  ) then
    raise exception 'Certificate document not found for this staff member.' using errcode = 'P0002';
  end if;

  if p_id is null then
    insert into public.staff_training_records (
      school_id, staff_id, title, provider, category, status, start_date, end_date, hours, expires_on,
      certificate_document_id, notes, created_by
    ) values (
      v_school, p_staff_id, btrim(p_title), nullif(btrim(coalesce(p_provider, '')), ''), p_category, p_status,
      p_start_date, p_end_date, p_hours, p_expires_on, p_certificate_document_id,
      nullif(btrim(coalesce(p_notes, '')), ''), auth_school_user_id()
    ) returning id into v_id;
  else
    update public.staff_training_records
       set title = btrim(p_title), provider = nullif(btrim(coalesce(p_provider, '')), ''), category = p_category,
           status = p_status, start_date = p_start_date, end_date = p_end_date, hours = p_hours,
           expires_on = p_expires_on, certificate_document_id = p_certificate_document_id,
           notes = nullif(btrim(coalesce(p_notes, '')), ''), updated_at = now()
     where id = p_id and school_id = v_school and staff_id = p_staff_id and status <> 'cancelled'
    returning id into v_id;
    if v_id is null then
      raise exception 'Training record not found or already cancelled.' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;
revoke all on function public.save_staff_training_record(uuid, uuid, text, text, text, text, date, date, numeric, date, uuid, text) from public, anon;
grant execute on function public.save_staff_training_record(uuid, uuid, text, text, text, text, date, date, numeric, date, uuid, text) to authenticated;

-- 4. Cancel a training record (status change; the row is kept).
create or replace function public.cancel_staff_training_record(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := auth_school_id();
  v_id uuid;
begin
  if v_school is null or not auth_has_permission('staff.manage') then
    raise exception 'Not authorized to manage staff training.' using errcode = '42501';
  end if;
  if not public.school_has_feature_flag(v_school, 'feature.hr.staff_training') then
    raise exception 'Staff training records are not enabled for this school.' using errcode = '55000';
  end if;
  update public.staff_training_records
     set status = 'cancelled', updated_at = now()
   where id = p_id and school_id = v_school and status <> 'cancelled'
  returning id into v_id;
  if v_id is null then
    raise exception 'Training record not found or already cancelled.' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.cancel_staff_training_record(uuid) from public, anon;
grant execute on function public.cancel_staff_training_record(uuid) to authenticated;

-- 5. Read-only expiry roll-up: contracts ending, qualifications expiring, training expiring.
--    days_left is negative when the date has passed (overdue). Looks back one year so very old
--    history does not drown the list. Active staff only.
create or replace function public.staff_expiry_overview(p_within_days int default 90)
returns table (
  kind text,
  staff_id uuid,
  staff_name text,
  label text,
  due_date date,
  days_left int
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := auth_school_id();
  v_today date := (now() at time zone 'Africa/Nairobi')::date;
  v_within int := least(greatest(coalesce(p_within_days, 90), 1), 365);
begin
  if v_school is null or not auth_has_permission('staff.read') then
    raise exception 'Not authorized to view staff records.' using errcode = '42501';
  end if;
  if not public.school_has_feature_flag(v_school, 'feature.hr.staff_training') then
    raise exception 'Staff training records are not enabled for this school.' using errcode = '55000';
  end if;

  return query
  select 'contract'::text, u.id, u.full_name,
         case u.contract_type when 'permanent' then 'Permanent contract' when 'part_time' then 'Part-time contract' else 'Contract' end,
         u.contract_end_date, (u.contract_end_date - v_today)::int
    from public.school_users u
   where u.school_id = v_school and u.status = 'active'
     and u.contract_end_date is not null
     and u.contract_end_date between v_today - 365 and v_today + v_within
  union all
  select 'qualification'::text, u.id, u.full_name, q.qualification_name, q.expiry_date, (q.expiry_date - v_today)::int
    from public.staff_qualifications q
    join public.school_users u on u.id = q.staff_id
   where q.school_id = v_school and u.school_id = v_school and u.status = 'active'
     and q.expiry_date is not null
     and q.expiry_date between v_today - 365 and v_today + v_within
  union all
  select 'training'::text, u.id, u.full_name, t.title, t.expires_on, (t.expires_on - v_today)::int
    from public.staff_training_records t
    join public.school_users u on u.id = t.staff_id
   where t.school_id = v_school and u.school_id = v_school and u.status = 'active'
     and t.status = 'completed' and t.expires_on is not null
     and t.expires_on between v_today - 365 and v_today + v_within
  order by 5, 3;
end;
$$;
revoke all on function public.staff_expiry_overview(int) from public, anon;
grant execute on function public.staff_expiry_overview(int) to authenticated;
