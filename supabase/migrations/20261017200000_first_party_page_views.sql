-- First-party page-view counter for the public marketing site.
--
-- Why: GA4's standard reports trail real traffic by hours, so on the admin "Today" view the
-- owner could not tell how many people a day's ads actually brought. This table is our own
-- count, written the moment a visitor opens a page, and read back by the admin console.
--
-- What it stores per page view -- and, just as deliberately, what it does not:
--   * the page path (query string and fragment are stripped before it gets here),
--   * the day, in Kenya time (the same day GA4 reports in and the admin "Today" range uses),
--   * a visitor_hash: sha256(daily random salt | IP | user agent). The raw IP and user agent are
--     hashed inside record_page_view() and never stored. The salt is random, kept for ~2 days,
--     then deleted, so a hash cannot be re-derived from an IP afterwards and the same person
--     gets a different hash every day. It answers "how many distinct visitors today" and
--     nothing about who they are or whether they came back another day,
--   * referrer host / utm tags from the landing URL (entry views only), and which ad network's
--     click id was present (google / meta) -- as a flag, NEVER the click id itself,
--   * 2-letter country (from the CDN's geo header), device class (mobile/tablet/desktop).
--   No cookies, no local-storage id, no IP, no user agent string, no click id, no name/email.
--
-- Write path: the /api/page-view route handler, service role only, via record_page_view().
-- There is deliberately NO anon/authenticated table grant and no policy, so the table cannot be
-- read or written from the browser with the anon key.
-- Read path: admin_page_view_summary(), super admin only (checks auth_is_super_admin()).
-- Retention: raw views are purged after 90 days and salts after 2 days by purge_old_page_views(),
-- called from the daily communication-retention cron.
--
-- Additive only: two new tables, three new functions. Safe to run twice.

create table if not exists public.site_page_views (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  -- The Kenya calendar day this view belongs to. Matches GA4's reporting time zone and the
  -- admin analytics day boundaries, so "Today" here and in Google mean the same day.
  view_day date not null default ((now() at time zone 'Africa/Nairobi')::date),
  path text not null
    check (char_length(path) between 1 and 200 and left(path, 1) = '/'),
  visitor_hash text not null check (char_length(visitor_hash) = 64),
  -- true for the first page view after a full page load (the landing page of a visit).
  is_entry boolean not null default false,
  referrer_host text check (referrer_host is null or char_length(referrer_host) <= 100),
  utm_source text check (utm_source is null or char_length(utm_source) <= 100),
  utm_medium text check (utm_medium is null or char_length(utm_medium) <= 100),
  utm_campaign text check (utm_campaign is null or char_length(utm_campaign) <= 100),
  -- Which ad network's click id was on the landing URL. A flag only; the id is never stored.
  click_platform text check (click_platform is null or click_platform in ('google', 'meta')),
  country text check (country is null or country ~ '^[A-Z]{2}$'),
  device text not null default 'unknown' check (device in ('mobile', 'tablet', 'desktop', 'unknown'))
);

comment on table public.site_page_views is
  'First-party anonymous page views of the public marketing site (no cookies, no IP, no click id). Written only by record_page_view() via the service role; read only through admin_page_view_summary() by super admins; purged after 90 days.';

create index if not exists site_page_views_view_day_idx
  on public.site_page_views (view_day);
create index if not exists site_page_views_visitor_created_idx
  on public.site_page_views (visitor_hash, created_at desc);
create index if not exists site_page_views_created_at_idx
  on public.site_page_views (created_at);

alter table public.site_page_views enable row level security;
revoke all on public.site_page_views from anon, authenticated;
revoke all on sequence public.site_page_views_id_seq from anon, authenticated;

-- One random salt per Kenya day. Created on first use, deleted after ~2 days, never readable
-- from the browser. Without the salt a stored visitor_hash cannot be matched back to an IP.
create table if not exists public.site_page_view_salts (
  day date primary key,
  salt text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
);

comment on table public.site_page_view_salts is
  'Daily random salts used to hash visitors in site_page_views. Service role only; rows are deleted after 2 days so old hashes can never be linked back to an IP.';

alter table public.site_page_view_salts enable row level security;
revoke all on public.site_page_view_salts from anon, authenticated;

-- Records one page view. Returns true if a row was written, false if it was dropped (bad path,
-- or this visitor already logged an implausible number of views in the last hour).
-- p_ip and p_user_agent are hashed here and discarded -- they are never written anywhere.
create or replace function public.record_page_view(
  p_path text,
  p_ip text,
  p_user_agent text,
  p_country text,
  p_device text,
  p_referrer_host text,
  p_utm_source text,
  p_utm_medium text,
  p_utm_campaign text,
  p_click_platform text,
  p_is_entry boolean
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_day date := (now() at time zone 'Africa/Nairobi')::date;
  v_salt text;
  v_hash text;
  v_recent integer;
begin
  if p_path is null or left(p_path, 1) <> '/' or char_length(p_path) > 200 then
    return false;
  end if;

  -- Look the salt up first; only the first view of a day creates it (and a concurrent first view
  -- is harmless: on conflict do nothing, then both read the same row).
  select salt into v_salt from public.site_page_view_salts where day = v_day;
  if v_salt is null then
    insert into public.site_page_view_salts (day) values (v_day) on conflict (day) do nothing;
    select salt into v_salt from public.site_page_view_salts where day = v_day;
  end if;
  if v_salt is null then
    return false;
  end if;

  v_hash := encode(
    sha256(convert_to(v_salt || '|' || coalesce(p_ip, '') || '|' || coalesce(p_user_agent, ''), 'UTF8')),
    'hex'
  );

  -- A real person does not open 300 pages in an hour. Caps what one visitor (or one script) can
  -- add, so the counter cannot be inflated or the table flooded from a single source.
  select count(*) into v_recent
  from public.site_page_views
  where visitor_hash = v_hash and created_at > now() - interval '1 hour';
  if v_recent >= 300 then
    return false;
  end if;

  insert into public.site_page_views (
    view_day, path, visitor_hash, is_entry, referrer_host,
    utm_source, utm_medium, utm_campaign, click_platform, country, device
  ) values (
    v_day,
    p_path,
    v_hash,
    coalesce(p_is_entry, false),
    left(nullif(p_referrer_host, ''), 100),
    left(nullif(p_utm_source, ''), 100),
    left(nullif(p_utm_medium, ''), 100),
    left(nullif(p_utm_campaign, ''), 100),
    case when p_click_platform in ('google', 'meta') then p_click_platform else null end,
    case when p_country ~ '^[A-Z]{2}$' then p_country else null end,
    case when p_device in ('mobile', 'tablet', 'desktop') then p_device else 'unknown' end
  );
  return true;
end;
$$;

revoke all on function public.record_page_view(text, text, text, text, text, text, text, text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.record_page_view(text, text, text, text, text, text, text, text, text, text, boolean)
  to service_role;

-- Retention sweep. Service role only (called by the cron route), never by a client.
create or replace function public.purge_old_page_views(p_days integer default 90)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_deleted integer;
begin
  if p_days < 1 then
    raise exception 'p_days must be at least 1';
  end if;

  delete from public.site_page_views
  where created_at < now() - make_interval(days => p_days);
  get diagnostics v_deleted = row_count;

  -- Keep today's and yesterday's salt only; older hashes can no longer be derived from an IP.
  delete from public.site_page_view_salts
  where day < ((now() at time zone 'Africa/Nairobi')::date - 1);

  return v_deleted;
end;
$$;

revoke all on function public.purge_old_page_views(integer) from public, anon, authenticated;
grant execute on function public.purge_old_page_views(integer) to service_role;

-- Everything the admin "our own count" panel shows, for a range of Kenya days (inclusive).
-- Single day -> hourly series; longer range -> daily series. "visitors" is the number of distinct
-- visitors per day, summed over the days (the hash changes daily, so someone who returns on a
-- second day counts again). "adVisits" counts landing views that carried a Google/Meta click id.
create or replace function public.admin_page_view_summary(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_views bigint;
  v_visitors bigint;
  v_ad bigint;
  v_first date;
  v_series jsonb;
  v_pages jsonb;
  v_sources jsonb;
  v_countries jsonb;
  v_devices jsonb;
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized to read site visit counts.';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Invalid date range.';
  end if;
  if p_to - p_from > 92 then
    raise exception 'Date range is too long.';
  end if;

  select count(*) into v_views
  from public.site_page_views where view_day between p_from and p_to;

  select coalesce(sum(c), 0) into v_visitors
  from (
    select count(distinct visitor_hash) as c
    from public.site_page_views
    where view_day between p_from and p_to
    group by view_day
  ) d;

  select count(*) into v_ad
  from public.site_page_views
  where view_day between p_from and p_to and is_entry and click_platform is not null;

  select min(view_day) into v_first from public.site_page_views;

  if p_from = p_to then
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'bucket', lpad(g.h::text, 2, '0') || ':00',
        'views', coalesce(v.views, 0),
        'visitors', coalesce(v.visitors, 0)
      ) order by g.h
    ), '[]'::jsonb)
    into v_series
    from generate_series(0, 23) as g(h)
    left join (
      select extract(hour from created_at at time zone 'Africa/Nairobi')::int as hr,
             count(*) as views,
             count(distinct visitor_hash) as visitors
      from public.site_page_views
      where view_day = p_from
      group by 1
    ) v on v.hr = g.h;
  else
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'bucket', to_char(g.d, 'YYYY-MM-DD'),
        'views', coalesce(v.views, 0),
        'visitors', coalesce(v.visitors, 0)
      ) order by g.d
    ), '[]'::jsonb)
    into v_series
    from generate_series(p_from, p_to, interval '1 day') as g(d)
    left join (
      select view_day,
             count(*) as views,
             count(distinct visitor_hash) as visitors
      from public.site_page_views
      where view_day between p_from and p_to
      group by view_day
    ) v on v.view_day = g.d::date;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('label', label, 'value', n) order by n desc, label), '[]'::jsonb)
  into v_pages
  from (
    select path as label, count(*) as n
    from public.site_page_views
    where view_day between p_from and p_to
    group by path
    order by n desc, path
    limit 10
  ) t;

  -- How visitors arrived: landing views only. utm_source wins, then the ad network when a click
  -- id was present, then the referring site, otherwise the visit is "Direct".
  select coalesce(jsonb_agg(jsonb_build_object('label', label, 'value', n) order by n desc, label), '[]'::jsonb)
  into v_sources
  from (
    select coalesce(
             nullif(lower(utm_source), ''),
             case click_platform when 'google' then 'google (ad click)' when 'meta' then 'meta (ad click)' end,
             referrer_host,
             'Direct'
           ) as label,
           count(*) as n
    from public.site_page_views
    where view_day between p_from and p_to and is_entry
    group by 1
    order by n desc, label
    limit 10
  ) t;

  select coalesce(jsonb_agg(jsonb_build_object('label', label, 'value', n) order by n desc, label), '[]'::jsonb)
  into v_countries
  from (
    select coalesce(country, '??') as label, count(*) as n
    from public.site_page_views
    where view_day between p_from and p_to
    group by 1
    order by n desc, label
    limit 10
  ) t;

  select coalesce(jsonb_agg(jsonb_build_object('label', label, 'value', n) order by n desc, label), '[]'::jsonb)
  into v_devices
  from (
    select device as label, count(*) as n
    from public.site_page_views
    where view_day between p_from and p_to
    group by device
    order by n desc, label
  ) t;

  return jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'views', v_views,
    'visitors', v_visitors,
    'adVisits', v_ad,
    'firstRecordedDay', v_first,
    'series', v_series,
    'topPages', v_pages,
    'sources', v_sources,
    'countries', v_countries,
    'devices', v_devices
  );
end;
$$;

revoke all on function public.admin_page_view_summary(date, date) from public, anon;
grant execute on function public.admin_page_view_summary(date, date) to authenticated;
