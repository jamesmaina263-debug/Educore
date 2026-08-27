-- Prefixed, plain-incrementing application reference numbers.
-- Replaces 'APP-2026-00001' (generic prefix, zero-padded, resets every year)
-- with '{SCHOOL-PREFIX}/{YY}/{DD}/{MM}/{SEQ}' e.g. GHS/26/27/08/001, where
-- SEQ is a plain incrementing counter (001, 002, 003...) that resets each
-- calendar year, scoped per school.
--
-- Note: the exact format originally requested ('ghs/27/08/001', day/month
-- only, no year) would collide across years -- the same string would be
-- generated for the same school on the same calendar day/month every year,
-- which breaks the existing unique(school_id, application_number)
-- constraint the very next year. Added a 2-digit year field to make the
-- annual reset actually safe while keeping every other part of the
-- requested format.
--
-- Historical applications keep their existing 'APP-YYYY-NNNNN' numbers --
-- this only changes numbers generated from here forward, matching how
-- admission_number's own format changes were handled previously
-- (20260822100723_defer_admission_number_to_enrollment.sql).

alter table public.schools add column if not exists application_number_prefix text;

-- Derives a short uppercase prefix from a school name: first letter of each
-- word (e.g. "Gititu High School" -> "GHS"). Falls back to the first 3
-- letters of the name for a single-word name, capped at 8 characters so an
-- unusually long name can't produce an unwieldy prefix.
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

-- Backfill existing schools that don't already have a prefix set.
update public.schools
set application_number_prefix = public.derive_school_prefix(name)
where application_number_prefix is null;

alter table public.schools alter column application_number_prefix set not null;

-- Auto-assign a prefix to every new school going forward, same as today's
-- backfill, unless one is explicitly provided at creation.
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

drop trigger if exists trg_schools_default_application_number_prefix on public.schools;
create trigger trg_schools_default_application_number_prefix
  before insert on public.schools
  for each row execute function public.set_default_application_number_prefix();

-- New generate_application_number(): {PREFIX}/{YY}/{DD}/{MM}/{SEQ:03d}.
-- SEQ resets to 1 every calendar year, scoped per school -- matches the
-- lock pattern already used by assign_admission_number()/record_payment()
-- elsewhere in this codebase to stay race-safe under concurrent submissions.
-- Signature, security definer, search_path, and grant hardening are
-- unchanged from 20260818075032_fix_generate_application_number_auth_gap.sql
-- (only the format logic inside the body changes).
create or replace function public.generate_application_number(p_school_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_prefix text;
  v_year2 text := to_char(now(), 'YY');
  v_day text := to_char(now(), 'DD');
  v_month text := to_char(now(), 'MM');
  v_next int;
begin
  if auth.uid() is not null and auth_school_id() is distinct from p_school_id then
    raise exception 'not authorized for this school';
  end if;

  select application_number_prefix into v_prefix from public.schools where id = p_school_id;
  if v_prefix is null then
    raise exception 'School has no application number prefix configured.';
  end if;

  -- Serialize concurrent submissions for the same school+year so two
  -- simultaneous applications can never compute the same "next" number.
  perform pg_advisory_xact_lock(hashtext(p_school_id::text || v_year2));

  select coalesce(max(substring(application_number from '(\d+)$')::int), 0) + 1
    into v_next
    from public.applications
    where school_id = p_school_id
      and application_number like v_prefix || '/' || v_year2 || '/%';

  return v_prefix || '/' || v_year2 || '/' || v_day || '/' || v_month || '/' || lpad(v_next::text, 3, '0');
end;
$function$;

revoke execute on function public.generate_application_number(uuid) from public;
revoke execute on function public.generate_application_number(uuid) from anon;
grant execute on function public.generate_application_number(uuid) to authenticated, service_role;
