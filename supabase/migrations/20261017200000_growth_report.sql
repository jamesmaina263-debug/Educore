-- Lead and conversion report (Growth Engine, PR 5 of 5).
--
-- ONE new read-only function, no tables, no columns, no data changes. It returns aggregate counts only
-- (plus campaign names and short staff-typed lost reasons) for the /admin/analytics "Pipeline and
-- conversion" section, so the page does one cheap call instead of many row-level queries per render.
--
-- Everything returned is MEASURED from existing tables. Anything that has no real data source is not
-- invented here; the UI labels those items "Not tracked yet".
--   * Range-based counts use the same Kenya-time day boundaries as the rest of the analytics page.
--   * Pipeline-now figures are a snapshot of today, not bound to the range.
--   * "Cohort" figures follow leads / trials that STARTED in the range and report where they are NOW
--     (stage history is free text in sales_lead_activities, so "ever reached a stage" is deliberately
--     not guessed at).
--   * Trial figures are school-level aggregates; no school is named and no learner data is read.
--   * AI usage is only what the outreach actions log (tokens, not money: no verified prices exist).
--
-- Reads: marketing_demo_requests, sales_leads, school_subscriptions, platform_invoices,
-- marketing_signup_attribution (service-only table, readable here because the function is SECURITY
-- DEFINER and super-admin gated), platform_admin_activity_log.
-- Needs 20261017180000_demo_request_to_sales_lead.sql (marketing_demo_requests.sales_lead_id).
--
-- Super admin only; revoked from public/anon; raises a real exception on a bad range.

create or replace function public.admin_growth_report(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_today date := (now() at time zone 'Africa/Nairobi')::date;
  v_demo jsonb;
  v_leads jsonb;
  v_pipeline jsonb;
  v_cohort jsonb;
  v_lost jsonb;
  v_trials jsonb;
  v_ai jsonb;
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to view growth reports.';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Choose a valid date range.';
  end if;
  if p_to - p_from > 400 then
    raise exception 'Date range is too long (400 days at most).';
  end if;

  v_start := p_from::timestamp at time zone 'Africa/Nairobi';
  v_end := (p_to + 1)::timestamp at time zone 'Africa/Nairobi';

  -- ---------- website demo requests, and how many reached the pipeline ----------
  select jsonb_build_object(
           'total', count(*)::int,
           'in_pipeline', (count(*) filter (where d.sales_lead_id is not null))::int,
           'by_campaign', coalesce((
             select jsonb_agg(to_jsonb(c) order by c.requests desc, c.campaign)
               from (
                 select coalesce(nullif(btrim(d2.utm_campaign), ''), '(none)') as campaign,
                        count(*)::int as requests,
                        (count(*) filter (where d2.sales_lead_id is not null))::int as in_pipeline,
                        (count(*) filter (where l.stage in ('demo_done', 'pilot', 'paid')))::int as reached_demo,
                        (count(*) filter (where l.stage = 'paid'))::int as paid
                   from public.marketing_demo_requests d2
                   left join public.sales_leads l on l.id = d2.sales_lead_id
                  where d2.created_at >= v_start and d2.created_at < v_end
                  group by 1
                  order by 2 desc, 1
                  limit 10
               ) c
           ), '[]'::jsonb)
         )
    into v_demo
    from public.marketing_demo_requests d
   where d.created_at >= v_start and d.created_at < v_end;

  -- ---------- leads created in the range, by source ----------
  select jsonb_build_object(
           'total', coalesce(sum(n), 0)::int,
           'by_source', coalesce(jsonb_agg(jsonb_build_object('source', source, 'n', n) order by n desc, source), '[]'::jsonb)
         )
    into v_leads
    from (
      select coalesce(l.source, 'unspecified') as source, count(*)::int as n
        from public.sales_leads l
       where l.created_at >= v_start and l.created_at < v_end
       group by 1
    ) s;

  -- ---------- pipeline today (snapshot, not range-bound) ----------
  select jsonb_build_object(
           'by_stage', coalesce((select jsonb_object_agg(stage, n) from (
                         select stage, count(*)::int as n from public.sales_leads group by stage) t), '{}'::jsonb),
           'open', (count(*) filter (where stage not in ('paid', 'lost')))::int,
           'overdue_followups', (count(*) filter (where stage not in ('paid', 'lost') and next_follow_up_on < v_today))::int,
           'due_today', (count(*) filter (where stage not in ('paid', 'lost') and next_follow_up_on = v_today))::int,
           'no_followup', (count(*) filter (where stage not in ('paid', 'lost') and next_follow_up_on is null))::int
         )
    into v_pipeline
    from public.sales_leads;

  -- ---------- leads created in the range: where they are now ----------
  select jsonb_build_object(
           'created', count(*)::int,
           'at_or_past_demo_booked', (count(*) filter (where stage in ('demo_booked', 'demo_done', 'pilot', 'paid')))::int,
           'at_or_past_demo_done', (count(*) filter (where stage in ('demo_done', 'pilot', 'paid')))::int,
           'pilot_or_paid', (count(*) filter (where stage in ('pilot', 'paid')))::int,
           'paid', (count(*) filter (where stage = 'paid'))::int,
           'lost', (count(*) filter (where stage = 'lost'))::int
         )
    into v_cohort
    from public.sales_leads
   where created_at >= v_start and created_at < v_end;

  -- ---------- leads marked lost in the range, with the reasons staff gave ----------
  select jsonb_build_object(
           'in_period', coalesce(sum(n), 0)::int,
           'reasons', coalesce(jsonb_agg(jsonb_build_object('reason', reason, 'n', n) order by n desc, reason)
                               filter (where rn <= 8), '[]'::jsonb)
         )
    into v_lost
    from (
      select reason, n, row_number() over (order by n desc, reason) as rn
        from (
          select lower(left(btrim(l.lost_reason), 80)) as reason, count(*)::int as n
            from public.sales_leads l
           where l.stage = 'lost' and l.stage_changed_at >= v_start and l.stage_changed_at < v_end
           group by 1
        ) g
    ) r;

  -- ---------- trials started in the range, and where those schools are now ----------
  select jsonb_build_object(
           'started', count(*)::int,
           'by_status', coalesce((select jsonb_object_agg(status, n) from (
                          select s2.status, count(*)::int as n
                            from public.school_subscriptions s2
                           where s2.created_at >= v_start and s2.created_at < v_end
                           group by s2.status) t), '{}'::jsonb),
           'paid_invoice', (count(*) filter (where exists (
                              select 1 from public.platform_invoices i
                               where i.school_id = s.school_id and i.status = 'paid')))::int,
           'by_campaign', coalesce((
             select jsonb_agg(to_jsonb(c) order by c.trials desc, c.campaign)
               from (
                 select coalesce(nullif(btrim(a.utm_campaign), ''), '(none)') as campaign,
                        count(*)::int as trials,
                        (count(*) filter (where exists (
                           select 1 from public.platform_invoices i2
                            where i2.school_id = s3.school_id and i2.status = 'paid')))::int as paid_invoice
                   from public.school_subscriptions s3
                   left join public.marketing_signup_attribution a on a.school_id = s3.school_id
                  where s3.created_at >= v_start and s3.created_at < v_end
                  group by 1
                  order by 2 desc, 1
                  limit 10
               ) c
           ), '[]'::jsonb)
         )
    into v_trials
    from public.school_subscriptions s
   where s.created_at >= v_start and s.created_at < v_end;

  -- ---------- outreach AI usage (tokens only; other AI features are not logged yet) ----------
  select coalesce(jsonb_agg(jsonb_build_object('action', action, 'calls', calls, 'total_tokens', tokens) order by action), '[]'::jsonb)
    into v_ai
    from (
      select a.action,
             count(*)::int as calls,
             coalesce(sum(case when (a.detail ->> 'total_tokens') ~ '^[0-9]{1,12}$'
                               then (a.detail ->> 'total_tokens')::bigint else 0 end), 0)::bigint as tokens
        from public.platform_admin_activity_log a
       where a.action in ('score_outbound_prospects', 'enrich_outbound_prospects')
         and a.created_at >= v_start and a.created_at < v_end
       group by a.action
    ) u;

  return jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'demo_requests', v_demo,
    'leads_created', v_leads,
    'pipeline_now', v_pipeline,
    'lead_cohort', v_cohort,
    'lost', v_lost,
    'trials', v_trials,
    'ai_usage', v_ai
  );
end;
$$;

revoke all on function public.admin_growth_report(date, date) from public, anon;
grant execute on function public.admin_growth_report(date, date) to authenticated;
