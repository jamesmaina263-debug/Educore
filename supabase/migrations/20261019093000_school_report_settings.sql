-- Per-school report settings: which optional parts of the mark sheet and report cards a school
-- wants. One small piece of per-school configuration, so it follows the precedent of
-- knec_cba_export_columns (20260903053000): a nullable jsonb column on schools, written only
-- through a SECURITY DEFINER function, NOT a new table or configuration system.
--
-- Keys (all booleans; a missing key or a NULL column means the default, which is "on", i.e.
-- exactly how reports behave today, so merging this changes nothing for any school):
--   ranking_enabled          show learner positions (rank) on mark sheets, report cards and the
--                            parent portal. The average is still shown; only positions are hidden.
--   show_competency_ratings  print the CBC competency ratings table on report cards.
--   show_signatures          print the signature lines (mark sheet verification block and the
--                            report card's class teacher / principal / parent lines).
--   show_class_statistics    print class mean / highest / lowest (or the performance-level
--                            summary for CBC) on the mark sheet.
--
-- Display-level only: rankings are still computed and stored in class_rankings exactly as before
-- (no change to recompute_class_rankings, close_exam or any trigger); the switch controls what
-- the application PRINTS and SHOWS. A guardian who queries the API directly can still read their
-- own child's stored position, which RLS already allowed.
--
-- Why a function and not a direct update: schools_update requires settings.branding.write, which
-- an exams administrator is not guaranteed to hold; this follows the knec.manage precedent and is
-- gated on exams.write instead, always scoped to the caller's own school via auth_school_id().

alter table public.schools add column report_settings jsonb;

comment on column public.schools.report_settings is
  'Per-school report options (booleans: ranking_enabled, show_competency_ratings, show_signatures, show_class_statistics). NULL or a missing key = default on. Edited via update_report_settings(); read by src/lib/academics/report-settings.ts.';

create or replace function public.update_report_settings(p_settings jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_school_id uuid;
  v_key text;
  v_known_keys text[] := array['ranking_enabled', 'show_competency_ratings', 'show_signatures', 'show_class_statistics'];
begin
  if not public.auth_has_permission('exams.write') then
    raise exception 'Not authorized to change report settings.';
  end if;

  if jsonb_typeof(p_settings) is distinct from 'object' then
    raise exception 'Report settings must be a JSON object.';
  end if;

  for v_key in select jsonb_object_keys(p_settings) loop
    if not (v_key = any (v_known_keys)) then
      raise exception 'Unknown report setting: %', v_key;
    end if;
    if jsonb_typeof(p_settings -> v_key) is distinct from 'boolean' then
      raise exception 'Report setting % must be true or false.', v_key;
    end if;
  end loop;

  v_school_id := public.auth_school_id();
  if v_school_id is null then
    raise exception 'Could not resolve your school.';
  end if;

  update public.schools set report_settings = p_settings where id = v_school_id;
end;
$function$;

revoke all on function public.update_report_settings(jsonb) from public, anon;
grant execute on function public.update_report_settings(jsonb) to authenticated;
