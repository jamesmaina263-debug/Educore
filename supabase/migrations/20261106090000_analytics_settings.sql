-- Per-school Academic Performance Analytics settings: the "needs attention" threshold, one value per
-- assessment model. One small piece of per-school configuration, so it follows the precedent of
-- report_settings (20261019093000): a nullable jsonb column on schools written only through a
-- SECURITY DEFINER function gated on exams.write, always scoped to the caller's own school.
--
-- Keys (numbers; a missing key or a NULL column means the built-in default, so merging this changes
-- nothing for any school):
--   intervention_threshold_percent  percentage marks below this average need attention (default 50)
--   intervention_threshold_level    CBC level points below this average need attention (default is the
--                                   midpoint of the scale, 2.5 on a four-level scale)
--
-- Read by src/lib/academics/analytics-settings.ts. Passing a key as JSON null clears it back to the default.

alter table public.schools add column if not exists analytics_settings jsonb;

comment on column public.schools.analytics_settings is
  'Per-school analytics options (numbers: intervention_threshold_percent 0-100, intervention_threshold_level 1-10). NULL or a missing key = built-in default. Edited via update_analytics_settings().';

create or replace function public.update_analytics_settings(p_settings jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_school_id uuid;
  v_key text;
  v_val jsonb;
  v_num numeric;
  v_merged jsonb;
  v_known_keys text[] := array['intervention_threshold_percent', 'intervention_threshold_level'];
begin
  if not public.auth_has_permission('exams.write') then
    raise exception 'Not authorized to change analytics settings.';
  end if;

  if jsonb_typeof(p_settings) is distinct from 'object' then
    raise exception 'Analytics settings must be a JSON object.';
  end if;

  v_school_id := public.auth_school_id();
  if v_school_id is null then
    raise exception 'Could not resolve your school.';
  end if;

  for v_key in select jsonb_object_keys(p_settings) loop
    if not (v_key = any (v_known_keys)) then
      raise exception 'Unknown analytics setting: %', v_key;
    end if;
    v_val := p_settings -> v_key;
    if jsonb_typeof(v_val) = 'null' then
      continue; -- clears the key below
    end if;
    if jsonb_typeof(v_val) is distinct from 'number' then
      raise exception 'Analytics setting % must be a number.', v_key;
    end if;
    v_num := (v_val #>> '{}')::numeric;
    if v_key = 'intervention_threshold_percent' and not (v_num > 0 and v_num <= 100) then
      raise exception 'intervention_threshold_percent must be above 0 and at most 100.';
    end if;
    if v_key = 'intervention_threshold_level' and not (v_num > 1 and v_num <= 10) then
      raise exception 'intervention_threshold_level must be above 1 and at most 10.';
    end if;
  end loop;

  -- Merge into what is already saved, then drop keys explicitly set to null.
  select coalesce(analytics_settings, '{}'::jsonb) into v_merged from public.schools where id = v_school_id;
  v_merged := coalesce(v_merged, '{}'::jsonb) || p_settings;
  for v_key in select jsonb_object_keys(v_merged) loop
    if jsonb_typeof(v_merged -> v_key) = 'null' then
      v_merged := v_merged - v_key;
    end if;
  end loop;

  update public.schools set analytics_settings = nullif(v_merged, '{}'::jsonb) where id = v_school_id;
end;
$function$;

revoke all on function public.update_analytics_settings(jsonb) from public, anon;
grant execute on function public.update_analytics_settings(jsonb) to authenticated;
