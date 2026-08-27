-- Reconstructed from live schema introspection (Supabase project alzqlvfaftwegptfbfej).
-- Original SQL never committed to the repo. Captures the live end-state so replaying
-- migrations from a clean database reaches the same schema as production.

-- assign_admission_number: for students not yet enrolled/active, an empty-string
-- admission_number is normalized to NULL (via nullif(trim(coalesce(...)))) rather than
-- being left as '' or treated as "already set" by the auto-assign guard below it.
CREATE OR REPLACE FUNCTION public.assign_admission_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_next int;
begin
  if new.status not in ('enrolled', 'active') then
    new.admission_number := nullif(trim(coalesce(new.admission_number, '')), '');
    return new;
  end if;

  if new.admission_number is not null and length(trim(new.admission_number)) > 0 then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext(new.school_id::text));

  select coalesce(max(admission_number::int), 0) + 1
    into v_next
    from public.students
    where school_id = new.school_id
      and admission_number ~ '^[0-9]+$';

  new.admission_number := lpad(v_next::text, 3, '0');
  return new;
end;
$function$;
