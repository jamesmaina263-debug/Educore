-- "Who opened /signup" list for /admin/analytics (step 1 of 2: the read-only database function).
--
-- One row per visitor per Kenya day who opened /signup in the range: when they first arrived, when they
-- opened /signup, where they landed, how they arrived (utm source, ad network or referring site), campaign,
-- country, device class and how many pages they viewed that day.
--
-- Read-only and additive: one new function. No table, column, policy or existing function is touched.
-- Anonymous by construction: site_page_views holds no name, email, IP, user agent or click id, and the
-- visitor hash is NOT returned. The hash changes daily, so the same person on two days appears as two rows.
--
-- Access: super admin only, checked inside the function. Same grants as admin_trial_funnel.

create or replace function public.admin_signup_visitors(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_rows jsonb;
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to view signup visitors.';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Choose a valid date range.';
  end if;
  if p_to - p_from > 400 then
    raise exception 'Date range is too long (400 days at most).';
  end if;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.first_seen desc), '[]'::jsonb)
    into v_rows
    from (
      select g.view_day as day,
             to_char(g.first_seen at time zone 'Africa/Nairobi', 'HH24:MI') as first_seen_time,
             to_char(g.signup_at at time zone 'Africa/Nairobi', 'HH24:MI') as signup_time,
             g.entry_path,
             coalesce(g.utm_source, g.click_platform, g.referrer_host, 'Direct') as source,
             g.utm_campaign as campaign,
             g.country,
             g.device,
             g.pages,
             g.first_seen
        from (
          select v.view_day,
                 v.visitor_hash,
                 min(v.created_at) as first_seen,
                 min(v.created_at) filter (where v.path = '/signup' or v.path like '/signup/%') as signup_at,
                 (array_agg(v.path order by v.created_at) filter (where v.is_entry))[1] as entry_path,
                 (array_agg(nullif(lower(v.utm_source), '') order by v.created_at) filter (where v.is_entry))[1] as utm_source,
                 (array_agg(v.click_platform order by v.created_at) filter (where v.is_entry))[1] as click_platform,
                 (array_agg(v.referrer_host order by v.created_at) filter (where v.is_entry))[1] as referrer_host,
                 (array_agg(v.utm_campaign order by v.created_at) filter (where v.is_entry))[1] as utm_campaign,
                 max(v.country) as country,
                 max(v.device) as device,
                 count(*)::int as pages
            from public.site_page_views v
           where v.view_day between p_from and p_to
           group by v.view_day, v.visitor_hash
          having bool_or(v.path = '/signup' or v.path like '/signup/%')
        ) g
       order by g.first_seen desc
       limit 100
    ) r;

  return jsonb_build_object('from', p_from, 'to', p_to, 'visitors', v_rows);
end;
$$;

revoke all on function public.admin_signup_visitors(date, date) from public, anon;
grant execute on function public.admin_signup_visitors(date, date) to authenticated;
