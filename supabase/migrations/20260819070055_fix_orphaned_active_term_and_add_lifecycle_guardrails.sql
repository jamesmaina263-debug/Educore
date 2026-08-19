-- 1. Data fix: close the one orphaned term (active under a closed year).
--    Found via audit: Gititu High School's "Allen" term was left active when
--    its academic year was closed. The existing terms_one_active_per_year
--    index only enforces uniqueness within a single academic_year_id, so it
--    didn't catch this -- a school with two years can have one active term
--    per year simultaneously, orphaning the closed year's term forever.
update public.terms t
set status = 'closed'
where t.status = 'active'
  and exists (
    select 1 from public.academic_years ay
    where ay.id = t.academic_year_id and ay.status = 'closed'
  );

-- 2. Cascade: closing a year should always close its terms. Root-cause fix --
--    without it, the same orphaning can recur any time a year is closed
--    (via setActiveAcademicYear demoting the prior active year, or any
--    future code path that flips academic_years.status).
create or replace function public.cascade_close_terms_on_year_close()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if tg_op = 'UPDATE' and new.status = 'closed' and old.status <> 'closed' then
    update public.terms
    set status = 'closed'
    where academic_year_id = new.id
      and status <> 'closed';
  end if;
  return new;
end;
$function$;

create trigger trg_academic_years_cascade_close
after update on public.academic_years
for each row execute function public.cascade_close_terms_on_year_close();

revoke execute on function public.cascade_close_terms_on_year_close() from public, anon, authenticated;

-- 3. Safety net: the missing half of the guardrail. academic_years already
--    has a one-active-per-school index; terms only had one-active-per-year.
--    This closes the actual gap -- true by constraint now, not just by
--    accident of which code path wrote the row.
create unique index terms_one_active_per_school
  on public.terms (school_id)
  where status = 'active';
