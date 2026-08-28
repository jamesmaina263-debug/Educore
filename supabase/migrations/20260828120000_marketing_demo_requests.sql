-- Phase 8 (marketing site, feature/marketing-site branch): contact-form backend.
--
-- Decision confirmed with the project owner: a single new table in this same
-- Supabase project, isolated from the app's real tenant/school schema, with
-- tight, insert-only RLS. This table has no foreign keys into `schools`,
-- `students`, or any other tenant table, is not read anywhere in the
-- authenticated product, and does not participate in any existing RLS
-- policy, permission, or role. It exists solely to receive public
-- demo-request submissions from the marketing site's /contact page.
--
-- Reading: the owner asked to be able to see submissions. There is
-- deliberately no SELECT policy for `anon` or `authenticated` here, so
-- submissions are readable only via Supabase Studio's Table/SQL editor
-- (which authenticates as the project owner and uses the service role,
-- bypassing RLS) -- never through the app or the public site.
create table if not exists public.marketing_demo_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  school_name text not null,
  role text not null,
  email text not null,
  phone text,
  student_count integer,
  message text,
  status text not null default 'new',
  constraint marketing_demo_requests_student_count_check
    check (student_count is null or student_count >= 0)
);

comment on table public.marketing_demo_requests is
  'Public marketing-site demo-request submissions (/contact). Isolated from the tenant schema, insert-only via RLS, read only through Supabase Studio.';

alter table public.marketing_demo_requests enable row level security;

-- Insert-only, for both anonymous visitors and any authenticated session a
-- visitor happens to be carrying (the marketing layout deliberately has no
-- session check, so either could submit this form). No role can select,
-- update, or delete rows under this policy set.
create policy "marketing_demo_requests_insert"
  on public.marketing_demo_requests
  for insert
  to anon, authenticated
  with check (true);
