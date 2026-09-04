-- Bug fix: validate_competency_indicator_rating_band() (20260904015517)
-- referenced schools.default_grading_scale_id -- a column that no longer
-- exists, dropped by 20260730202426 in favor of grading_scales.is_default
-- being the sole source of truth (one default per school PER MODEL_TYPE,
-- via the partial unique index). Would have raised "column does not exist"
-- on the very first insert -- caught before any UI was built on top of it,
-- no ratings had been saved yet.
create or replace function public.validate_competency_indicator_rating_band()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_scale_id uuid;
begin
  select id into v_scale_id from grading_scales
    where school_id = new.school_id and model_type = 'competency'
    order by is_default desc limit 1;

  if v_scale_id is null then
    raise exception 'No competency-model grading scale configured for this school. Configure one under Exams settings first.';
  end if;

  if not exists (select 1 from grading_scale_bands where id = new.band_id and grading_scale_id = v_scale_id) then
    raise exception 'Selected rating does not belong to this school''s competency grading scale.';
  end if;

  new.updated_at := now();
  return new;
end;
$$;
