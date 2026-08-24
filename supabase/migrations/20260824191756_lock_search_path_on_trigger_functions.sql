-- Supabase security linter flagged these two trigger functions for a mutable
-- search_path. Neither is SECURITY DEFINER or directly callable by users, so
-- risk is low, but locking search_path is the correct hardening regardless.
create or replace function public.enforce_student_status_transition()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.status is distinct from old.status then
    if not (
      (old.status = 'applied'     and new.status in ('approved','withdrawn')) or
      (old.status = 'approved'    and new.status in ('enrolled','withdrawn')) or
      (old.status = 'enrolled'    and new.status in ('active','withdrawn','transferred')) or
      (old.status = 'active'      and new.status in ('withdrawn','transferred','graduated')) or
      -- Returning / re-admitted / transferred-back students re-entering
      -- through the normal Admissions pipeline (createOrLinkStudent ->
      -- complete_enrollment), which links to the *existing* student row
      -- rather than creating a new one, per Brief 4.16's "avoid duplicate
      -- student records" requirement.
      (old.status in ('withdrawn','transferred','graduated') and new.status = 'active')
    ) then
      raise exception 'invalid student status transition: % -> %', old.status, new.status;
    end if;

    new.status_changed_at := now();

    if new.status in ('withdrawn','transferred','graduated') then
      new.current_class_id := null;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.subjects_lock_catalogue_fields()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.catalogue_id is distinct from old.catalogue_id
     or new.name is distinct from old.name
     or new.code is distinct from old.code
     or new.is_core is distinct from old.is_core
     or new.school_id is distinct from old.school_id then
    raise exception 'subjects: only is_active may be changed after activation -- catalogue_id/name/code/is_core/school_id are locked to the master catalogue';
  end if;
  return new;
end;
$$;
