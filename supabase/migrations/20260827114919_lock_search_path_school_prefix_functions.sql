-- Supabase's security advisor flagged derive_school_prefix() and
-- set_default_application_number_prefix() (introduced in
-- 20260827120000_school_prefixed_application_numbers.sql) for a mutable
-- search_path -- the same class of finding this codebase already locked
-- down everywhere else in 20260824191756_lock_search_path_on_trigger_functions.sql.
-- Neither function is SECURITY DEFINER, so the risk here is low, but fixing
-- it now for consistency rather than leaving new debt.
--
-- Only search_path is added; no logic changes.

create or replace function public.derive_school_prefix(p_name text)
returns text
language plpgsql
immutable
set search_path to 'public'
as $$
declare
  v_words text[];
  v_prefix text := '';
  w text;
begin
  v_words := regexp_split_to_array(trim(p_name), '\s+');
  if array_length(v_words, 1) > 1 then
    foreach w in array v_words loop
      if length(w) > 0 then
        v_prefix := v_prefix || upper(left(w, 1));
      end if;
    end loop;
  else
    v_prefix := upper(left(coalesce(p_name, ''), 3));
  end if;
  return left(v_prefix, 8);
end;
$$;

create or replace function public.set_default_application_number_prefix()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.application_number_prefix is null or trim(new.application_number_prefix) = '' then
    new.application_number_prefix := public.derive_school_prefix(new.name);
  end if;
  return new;
end;
$$;
