update storage.buckets
set file_size_limit = 10485760,
    allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
where id in ('student-documents', 'staff-documents', 'application-documents');

create table rate_limit_events (
  id uuid primary key default gen_random_uuid(),
  bucket text not null,
  created_at timestamptz not null default now()
);

create index idx_rate_limit_events_bucket_created on rate_limit_events(bucket, created_at desc);

alter table rate_limit_events enable row level security;

create or replace function increment_and_check_rate_limit(
  p_bucket text,
  p_max_events int,
  p_window_seconds int
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  delete from rate_limit_events
  where bucket = p_bucket
    and created_at < now() - make_interval(secs => p_window_seconds);

  select count(*) into v_count from rate_limit_events where bucket = p_bucket;

  if v_count >= p_max_events then
    return false;
  end if;

  insert into rate_limit_events (bucket) values (p_bucket);
  return true;
end;
$$;

revoke execute on function increment_and_check_rate_limit(text, int, int) from public, anon, authenticated;
