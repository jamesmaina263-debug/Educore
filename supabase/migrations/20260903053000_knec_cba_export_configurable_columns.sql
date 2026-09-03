-- KNEC CBA export: configurable, CSV-first column layout (follow-up to
-- 20260903021210_knec_cba_export.sql, per James's explicit go-ahead not to wait for KNEC's
-- real upload template).
--
-- The export shipped in the previous migration used a fixed, hardcoded 10-column .xlsx layout.
-- Nobody -- not this investigation, not KNEC's own published materials -- knows what column
-- names/order the real cba.knec.ac.ke upload will actually expect. Rather than keep guessing in
-- code (requiring a redeploy every time a school learns something new from the portal), the
-- column set becomes school-editable data: an ordered list of {key, label, enabled}, stored on
-- schools and changeable any time from Integrations > KNEC CBA > Configure export columns. `key`
-- always maps to the same underlying data field; `label` is free text so a school can rename a
-- header to match whatever KNEC's real template turns out to call it.
--
-- Deliberately NOT a new table: this is one small piece of per-school configuration, not a
-- growing dataset, so it follows the same shape as knec_school_code -- a column on schools.
-- Deliberately IS a SECURITY DEFINER function rather than a direct table update, unlike
-- knec_school_code -- schools_update (see 20260728055625_phase0_step2_auth_helpers_and_rls.sql)
-- is gated on settings.branding.write, which a deputy_principal/academic_officer holding
-- knec.manage is not guaranteed to have. Routing through a function keyed on knec.manage avoids
-- inheriting that mismatch and matches this feature's own established convention ("every write
-- path is a SECURITY DEFINER function").

alter table public.schools
  add column knec_cba_export_columns jsonb;

comment on column public.schools.knec_cba_export_columns is
  'School-editable column layout for the provisional KNEC CBA export (see 20260903021210_knec_cba_export.sql). Null = use the built-in default layout (src/lib/knec-cba-export-columns.ts). Ordered jsonb array of {key, label, enabled}; key must be one of the fixed set of exportable fields, enforced in update_knec_cba_export_columns(). Written only through that function, never directly -- see its comment for why this doesn''t reuse the schools_update RLS policy.';

create or replace function public.update_knec_cba_export_columns(p_columns jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_school_id uuid;
  v_known_keys text[] := array[
    'upi_number', 'admission_number', 'first_name', 'last_name', 'other_names',
    'class_name', 'learning_area', 'strand', 'sub_strand', 'competency_level',
    'knec_school_code'
  ];
begin
  if not public.auth_has_permission('knec.manage') then
    raise exception 'Not authorized to configure the KNEC CBA export layout.';
  end if;

  if jsonb_typeof(p_columns) is distinct from 'array' then
    raise exception 'Column configuration must be a JSON array.';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_columns) elem
    where not (elem ? 'key' and elem ? 'label' and elem ? 'enabled')
       or jsonb_typeof(elem->'enabled') is distinct from 'boolean'
       or jsonb_typeof(elem->'label') is distinct from 'string'
       or (elem->>'key') is null
       or not ((elem->>'key') = any (v_known_keys))
  ) then
    raise exception 'Each column entry must have a known key, a text label, and a boolean enabled flag.';
  end if;

  if (select count(*) from jsonb_array_elements(p_columns)) = 0 then
    raise exception 'Column configuration cannot be empty.';
  end if;

  if not exists (
    select 1 from jsonb_array_elements(p_columns) elem where (elem->>'enabled')::boolean
  ) then
    raise exception 'At least one column must be enabled.';
  end if;

  v_school_id := public.auth_school_id();

  update public.schools
  set knec_cba_export_columns = p_columns
  where id = v_school_id;
end;
$function$;
revoke all on function public.update_knec_cba_export_columns(jsonb) from public;
grant execute on function public.update_knec_cba_export_columns(jsonb) to authenticated;
