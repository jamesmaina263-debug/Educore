-- Reconstructed from live schema introspection (Supabase project alzqlvfaftwegptfbfej).
-- Original SQL text for this migration was applied directly (via MCP apply_migration) and
-- never committed to the repo. This file captures the live end-state of the objects this
-- migration touched, so that replaying migrations from a clean database reaches the same
-- schema as production. Idempotent (CREATE OR REPLACE / IF NOT EXISTS) by construction.

-- Mark-band resolution trigger function, current live definition. Handles both the
-- 'numeric' grading model (raw_score must fall inside a configured band range) and the
-- 'cbc' competency model (band_id must belong to the class's grading scale).
CREATE OR REPLACE FUNCTION public.resolve_mark_band()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_scale_id uuid;
  v_model text;
  v_max_score numeric;
  v_resolved_band uuid;
begin
  select coalesce(
    c.grading_scale_id,
    (select gs.id from grading_scales gs where gs.school_id = c.school_id and gs.is_default limit 1)
  ) into v_scale_id
  from classes c
  where c.id = new.class_id;

  if v_scale_id is null then
    raise exception 'No grading scale configured for this class or its school. Configure one under Exams settings first.';
  end if;

  select model_type into v_model from grading_scales where id = v_scale_id;

  select max_score into v_max_score from exam_subjects
    where exam_id = new.exam_id and class_id = new.class_id and subject_id = new.subject_id;

  if v_model = 'numeric' then
    if new.raw_score is null then
      raise exception 'A numeric score is required for this subject.';
    end if;
    if new.raw_score > v_max_score then
      raise exception 'Score % exceeds the max score % for this subject.', new.raw_score, v_max_score;
    end if;
    select id into v_resolved_band from grading_scale_bands
      where grading_scale_id = v_scale_id
        and new.raw_score >= min_score and new.raw_score <= max_score
      limit 1;
    if v_resolved_band is null then
      raise exception 'Score % does not fall within any configured band for this grading scale.', new.raw_score;
    end if;
    new.band_id := v_resolved_band;
  elsif v_model = 'cbc' then
    if new.band_id is null then
      raise exception 'A competency level is required for this subject.';
    end if;
    if not exists (select 1 from grading_scale_bands where id = new.band_id and grading_scale_id = v_scale_id) then
      raise exception 'Selected competency level does not belong to this class''s grading scale.';
    end if;
    new.raw_score := null;
  end if;

  new.updated_at := now();
  return new;
end;
$function$;
