-- WP 7.5: Lesson plans linked to schemes of work (additive, dark behind feature.academics.lesson_plans).
--
-- One lesson plan per scheme_of_work_entries row (the week/lesson slot of a teacher's scheme). Access reuses the
-- existing scheme_of_work.read / write / write_any permissions exactly as the entries do: a teacher edits plans
-- under their own schemes, principals/owners can read and (write_any) edit any. Nothing in the scheme tables
-- changes. school_id and teacher_id are copied from the scheme by a trigger, never trusted from the client.
-- Content is teacher-written or prefilled from the entry; no AI and no invented curriculum.

insert into public.platform_feature_flags (key, label, description)
select 'feature.academics.lesson_plans',
       'Lesson plans linked to schemes of work',
       'Lets teachers write a lesson plan for each lesson row of their scheme of work, prefilled from the scheme. Off by default.'
where not exists (
  select 1 from public.platform_feature_flags where lower(key) = 'feature.academics.lesson_plans'
);

create table if not exists public.lesson_plans (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  scheme_entry_id uuid not null unique references public.scheme_of_work_entries(id) on delete cascade,
  teacher_id uuid not null references public.school_users(id),
  objectives text,
  introduction text,
  development text,
  conclusion text,
  assessment text,
  resources text,
  homework text,
  reflection text,
  duration_minutes smallint check (duration_minutes is null or duration_minutes between 5 and 240),
  status text not null default 'draft' check (status in ('draft', 'ready', 'taught')),
  taught_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'taught' or taught_on is not null)
);
comment on table public.lesson_plans is
  'One plan per scheme entry. school_id/teacher_id are set from the scheme by trigger. Access mirrors scheme_of_work_entries.';
create index if not exists lesson_plans_school_idx on public.lesson_plans (school_id);
create index if not exists lesson_plans_teacher_idx on public.lesson_plans (teacher_id);

-- school_id / teacher_id always come from the scheme; a client cannot move a plan to another school or teacher.
create or replace function public.lesson_plans_bind_scheme()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_school uuid;
  v_teacher uuid;
begin
  select s.school_id, s.teacher_id into v_school, v_teacher
    from public.scheme_of_work_entries e
    join public.schemes_of_work s on s.id = e.scheme_id
   where e.id = new.scheme_entry_id;
  if v_school is null then
    raise exception 'Scheme entry not found.' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' and new.scheme_entry_id is distinct from old.scheme_entry_id then
    raise exception 'A lesson plan cannot be moved to another lesson.' using errcode = '22023';
  end if;
  new.school_id := v_school;
  new.teacher_id := v_teacher;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists trg_lesson_plans_bind_scheme on public.lesson_plans;
create trigger trg_lesson_plans_bind_scheme
  before insert or update on public.lesson_plans
  for each row execute function public.lesson_plans_bind_scheme();

alter table public.lesson_plans enable row level security;

drop policy if exists lesson_plans_select on public.lesson_plans;
create policy lesson_plans_select on public.lesson_plans for select
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('scheme_of_work.read')));

-- Writes need the flag as well as the scheme permission (my_school_has_feature_flag fails closed).
drop policy if exists lesson_plans_write on public.lesson_plans;
create policy lesson_plans_write on public.lesson_plans for all
  using (
    school_id = auth_school_id()
    and public.my_school_has_feature_flag('feature.academics.lesson_plans')
    and (auth_has_permission('scheme_of_work.write_any')
         or (auth_has_permission('scheme_of_work.write') and teacher_id = auth_school_user_id()))
  )
  with check (
    school_id = auth_school_id()
    and public.my_school_has_feature_flag('feature.academics.lesson_plans')
    and (auth_has_permission('scheme_of_work.write_any')
         or (auth_has_permission('scheme_of_work.write') and teacher_id = auth_school_user_id()))
  );

-- Start a plan from a scheme entry, prefilled from what the scheme already says. Idempotent: returns the
-- existing plan if there is one. SECURITY INVOKER, so the same row-level security applies as a direct insert.
create or replace function public.create_lesson_plan_from_entry(p_entry_id uuid)
returns uuid
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v_id uuid;
  e public.scheme_of_work_entries%rowtype;
begin
  select id into v_id from public.lesson_plans where scheme_entry_id = p_entry_id;
  if v_id is not null then
    return v_id;
  end if;
  select * into e from public.scheme_of_work_entries where id = p_entry_id;
  if not found then
    raise exception 'Scheme entry not found.' using errcode = '22023';
  end if;
  if not public.my_school_has_feature_flag('feature.academics.lesson_plans') then
    raise exception 'Lesson plans are not enabled for this school.' using errcode = '55000';
  end if;
  insert into public.lesson_plans (school_id, teacher_id, scheme_entry_id, objectives, development, assessment, resources)
  values (auth_school_id(), auth_school_user_id(), p_entry_id, e.learning_outcomes,
          nullif(btrim(concat_ws(E'\n\n', e.content, e.activities)), ''), e.assessment_methods, e.resources)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.create_lesson_plan_from_entry(uuid) from public, anon;
grant execute on function public.create_lesson_plan_from_entry(uuid) to authenticated;

revoke all on function public.lesson_plans_bind_scheme() from public, anon, authenticated;
