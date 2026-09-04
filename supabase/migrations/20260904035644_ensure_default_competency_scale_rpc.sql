-- Only exams.write (deputy_principal/principal/school_owner) can create a
-- grading_scale directly -- correct for deliberate scale configuration, but
-- means an ordinary class/homeroom teacher (competency_ratings.write only)
-- could never get a competency-model scale provisioned for their school
-- before the rating grid becomes usable. A narrow SECURITY DEFINER RPC:
-- idempotent (no-ops if the school already has one), seeds exactly the
-- default 3-2-1 scale from the appraisal directive, callable by anyone who
-- can actually rate (competency_ratings.write or .write_any) -- not a
-- general grading_scales bypass.
create or replace function public.ensure_default_competency_scale()
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school_id uuid := auth_school_id();
  v_scale_id uuid;
begin
  if not (auth_has_permission('competency_ratings.write') or auth_has_permission('competency_ratings.write_any')) then
    raise exception 'Not authorized.';
  end if;

  select id into v_scale_id from grading_scales
    where school_id = v_school_id and model_type = 'competency'
    order by is_default desc limit 1;

  if v_scale_id is not null then
    return v_scale_id;
  end if;

  insert into grading_scales (school_id, name, model_type, is_default)
    values (v_school_id, 'Competency Rating (3-2-1)', 'competency', false)
    returning id into v_scale_id;

  insert into grading_scale_bands (grading_scale_id, label, points, level_order) values
    (v_scale_id, 'Consistently Demonstrates', 3, 1),
    (v_scale_id, 'Developing', 2, 2),
    (v_scale_id, 'Needs Support', 1, 3);

  return v_scale_id;
end;
$$;

revoke execute on function public.ensure_default_competency_scale() from public, anon;
grant execute on function public.ensure_default_competency_scale() to authenticated;
