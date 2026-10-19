-- Trial funnel for /admin/analytics: website visitors -> /signup visitors -> trials started -> what those
-- trial schools have set up so far (students, fee structures, invoices, a second user).
--
-- Read-only and additive: one new function. No table, column, policy or existing function is touched, and
-- nothing is written, backfilled or sent. Safe to run twice (create or replace).
--
-- Every figure is a count measured from EduCore's own records. No learner or staff details leave the
-- database: only school-level counts. Activation figures say where the schools ARE NOW, not what happened
-- on each trial day (school-level usage by day is not recorded).
--
--   site_visitors / signup_visitors  site_page_views, distinct visitors per Kenya day summed over the range
--                                    (same convention as admin_page_view_summary, because the visitor hash
--                                    changes daily). signup_visitors = anyone who opened /signup.
--   trials_started                   school_subscriptions created in the range (same definition as the
--                                    "Trials started" figure in admin_growth_report, so the numbers match).
--   activation cohort                those trials minus the demo school and qa-* test schools, which would
--                                    otherwise inflate setup numbers. Reported as cohort_schools.
--
-- Access: super admin only, checked inside the function. Same grants as admin_growth_report.

create or replace function public.admin_trial_funnel(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_site bigint;
  v_signup bigint;
  v_trials integer;
  v_cohort jsonb;
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to view the trial funnel.';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Choose a valid date range.';
  end if;
  if p_to - p_from > 400 then
    raise exception 'Date range is too long (400 days at most).';
  end if;

  v_start := p_from::timestamp at time zone 'Africa/Nairobi';
  v_end := (p_to + 1)::timestamp at time zone 'Africa/Nairobi';

  select coalesce(sum(d.n), 0)::bigint into v_site
    from (
      select count(distinct visitor_hash) as n
        from public.site_page_views
       where view_day between p_from and p_to
       group by view_day
    ) d;

  select coalesce(sum(d.n), 0)::bigint into v_signup
    from (
      select count(distinct visitor_hash) as n
        from public.site_page_views
       where view_day between p_from and p_to
         and (path = '/signup' or path like '/signup/%')
       group by view_day
    ) d;

  select count(*)::int into v_trials
    from public.school_subscriptions s
   where s.created_at >= v_start and s.created_at < v_end;

  select jsonb_build_object(
           'cohort_schools', count(*)::int,
           'with_students', (count(*) filter (where exists (
                               select 1 from public.students st where st.school_id = c.school_id)))::int,
           'with_fee_structure', (count(*) filter (where exists (
                               select 1 from public.fee_structures f where f.school_id = c.school_id)))::int,
           'with_invoice', (count(*) filter (where exists (
                               select 1 from public.invoices i where i.school_id = c.school_id)))::int,
           'with_second_user', (count(*) filter (where (
                               select count(*) from public.school_users u
                                where u.school_id = c.school_id and u.status = 'active') >= 2))::int,
           'set_up_basics', (count(*) filter (where
                               exists (select 1 from public.students st where st.school_id = c.school_id)
                           and exists (select 1 from public.fee_structures f where f.school_id = c.school_id)
                           and exists (select 1 from public.invoices i where i.school_id = c.school_id)))::int
         )
    into v_cohort
    from (
      select s.school_id
        from public.school_subscriptions s
        join public.schools sc on sc.id = s.school_id
       where s.created_at >= v_start and s.created_at < v_end
         and sc.slug <> 'demo-academy'
         and sc.slug not like 'qa-%'
    ) c;

  return jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'site_visitors', v_site,
    'signup_visitors', v_signup,
    'trials_started', v_trials,
    'activation', v_cohort
  );
end;
$$;

revoke all on function public.admin_trial_funnel(date, date) from public, anon;
grant execute on function public.admin_trial_funnel(date, date) to authenticated;
