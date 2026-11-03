-- WP 8.3 (1/2): web push subscriptions for the PWA. Additive only; ships dark.
--
-- * New flag feature.pwa.web_push (catalog entry, enabled for nobody).
-- * New table push_subscriptions: one row per browser/device a signed-in person chose to enable notifications on.
--   The endpoint plus the two keys (p256dh, auth) are what lets a server send to that device, so the KEYS ARE
--   NEVER READABLE by browser roles: authenticated gets column-level SELECT on the harmless columns only, and the
--   sender reads the keys through a service_role-only function. Rows are reached only through the functions below;
--   there are no write policies.
-- * Functions: register_push_subscription / revoke_push_subscription (the signed-in person, own device, flag on);
--   push_targets_for_users / mark_push_subscription_dead (service_role only, used by the server-side sender).
-- * Nothing is sent by anything in this migration. Nothing existing is touched: no table, function, policy,
--   trigger or grant that already exists changes, and public/sw.js (the offline service worker) is not involved.
-- Rollback: switch the flag off (register refuses, the sender sees no targets). Nothing else depends on these objects.

-- 1. Flag catalog entry.
insert into public.platform_feature_flags (key, label, description)
select 'feature.pwa.web_push',
       'Web push notifications (PWA)',
       'Lets a signed-in person enable push notifications on their device. Infrastructure only: sends nothing by itself. Off by default.'
where not exists (
  select 1 from public.platform_feature_flags where lower(key) = 'feature.pwa.web_push'
);

-- 2. Subscriptions.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  school_user_id uuid not null references public.school_users(id) on delete cascade,
  endpoint text not null check (char_length(endpoint) between 20 and 2048 and endpoint like 'https://%'),
  p256dh text not null check (char_length(p256dh) between 20 and 200),
  auth text not null check (char_length(auth) between 8 and 100),
  user_agent text check (user_agent is null or char_length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz
);
comment on table public.push_subscriptions is
  'Web push subscriptions, one per browser. p256dh/auth are sending secrets: never readable by browser roles. Written only by register_/revoke_push_subscription() and the service_role sender functions.';
create unique index if not exists push_subscriptions_endpoint_uniq on public.push_subscriptions (endpoint);
create index if not exists push_subscriptions_user on public.push_subscriptions (school_id, school_user_id) where revoked_at is null;
alter table public.push_subscriptions enable row level security;

-- A person sees only their own devices, and only the harmless columns.
revoke all on public.push_subscriptions from anon, authenticated;
grant select (id, school_id, school_user_id, endpoint, user_agent, created_at, last_seen_at, revoked_at)
  on public.push_subscriptions to authenticated;
drop policy if exists push_subscriptions_select_own on public.push_subscriptions;
create policy push_subscriptions_select_own on public.push_subscriptions for select
  using (
    auth_is_super_admin()
    or (
      school_id = auth_school_id()
      and school_user_id = auth_school_user_id()
      and public.my_school_has_feature_flag('feature.pwa.web_push')
    )
  );

-- 3. Register (or re-register) this browser for the signed-in person.
--    A browser has one endpoint. If the same browser is later used by someone else who signs in and enables
--    notifications, the row moves to them (and stops delivering to the previous person).
create or replace function public.register_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := auth_school_id();
  v_user uuid := auth_school_user_id();
  v_id uuid;
begin
  if v_school is null or v_user is null then
    raise exception 'Not signed in to a school.' using errcode = '42501';
  end if;
  if not public.school_has_feature_flag(v_school, 'feature.pwa.web_push') then
    raise exception 'Push notifications are not enabled for this school.' using errcode = '55000';
  end if;
  if p_endpoint is null or char_length(p_endpoint) not between 20 and 2048 or p_endpoint not like 'https://%'
     or p_p256dh is null or char_length(p_p256dh) not between 20 and 200
     or p_auth is null or char_length(p_auth) not between 8 and 100
     or (p_user_agent is not null and char_length(p_user_agent) > 300) then
    raise exception 'Invalid push subscription.' using errcode = '22023';
  end if;

  insert into public.push_subscriptions as s (school_id, school_user_id, endpoint, p256dh, auth, user_agent)
  values (v_school, v_user, p_endpoint, p_p256dh, p_auth, nullif(btrim(coalesce(p_user_agent, '')), ''))
  on conflict (endpoint) do update
    set school_id = excluded.school_id,
        school_user_id = excluded.school_user_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_agent = excluded.user_agent,
        last_seen_at = now(),
        revoked_at = null
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.register_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.register_push_subscription(text, text, text, text) to authenticated;

-- 4. Turn notifications off for this browser (the row is kept, marked revoked).
create or replace function public.revoke_push_subscription(p_endpoint text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := auth_school_id();
  v_user uuid := auth_school_user_id();
begin
  if v_school is null or v_user is null then
    raise exception 'Not signed in to a school.' using errcode = '42501';
  end if;
  update public.push_subscriptions
     set revoked_at = now()
   where endpoint = p_endpoint and school_id = v_school and school_user_id = v_user and revoked_at is null;
end;
$$;
revoke all on function public.revoke_push_subscription(text) from public, anon;
grant execute on function public.revoke_push_subscription(text) to authenticated;

-- 5. Sender side (service_role only): active subscriptions for named people in one school, flag on.
create or replace function public.push_targets_for_users(p_school_id uuid, p_school_user_ids uuid[])
returns table (id uuid, school_user_id uuid, endpoint text, p256dh text, auth text)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if p_school_id is null or p_school_user_ids is null or coalesce(array_length(p_school_user_ids, 1), 0) = 0 then
    return;
  end if;
  if array_length(p_school_user_ids, 1) > 500 then
    raise exception 'Too many recipients in one call (500 at most).' using errcode = '22023';
  end if;
  if not public.school_has_feature_flag(p_school_id, 'feature.pwa.web_push') then
    return;
  end if;
  return query
  select s.id, s.school_user_id, s.endpoint, s.p256dh, s.auth
    from public.push_subscriptions s
   where s.school_id = p_school_id
     and s.school_user_id = any (p_school_user_ids)
     and s.revoked_at is null;
end;
$$;
revoke all on function public.push_targets_for_users(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.push_targets_for_users(uuid, uuid[]) to service_role;

-- 6. Sender side (service_role only): the push service said this endpoint is gone (404/410).
create or replace function public.mark_push_subscription_dead(p_endpoint text)
returns void
language sql
security definer
set search_path to 'public'
as $$
  update public.push_subscriptions set revoked_at = now() where endpoint = p_endpoint and revoked_at is null;
$$;
revoke all on function public.mark_push_subscription_dead(text) from public, anon, authenticated;
grant execute on function public.mark_push_subscription_dead(text) to service_role;
