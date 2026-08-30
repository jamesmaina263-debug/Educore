-- Institution profile fields for the redesigned /signup form (screenshot spec).
-- All new columns are nullable at the DB level, deliberately: every one of
-- them is enforced as *required* at the form + server-action layer for new
-- signups, but existing schools have none of this data and there is no
-- honest default to backfill (school_type, ownership_type, etc. can't be
-- guessed). Forcing NOT NULL here would mean inventing data for real
-- schools. CHECK constraints below still apply -- Postgres CHECK passes
-- automatically on NULL, so this is safe (same reasoning already used for
-- nullable FK-scoped columns elsewhere in this schema).
--
-- "Gender" in the original screenshot is replaced by school_type
-- (boys/girls/mixed) per spec -- this describes the school's student
-- intake, not a person, so it lives here on `schools`, not `school_users`.
-- "Your Title" (Mr/Mrs/Dr/...) is the *signer's* salutation, so that one
-- goes on `school_users` instead, alongside full_name.

alter table public.schools
  add column if not exists description text,
  add column if not exists school_type text,
  add column if not exists cycle_type text,
  add column if not exists ownership_type text,
  add column if not exists institution_type text,
  add column if not exists country_code text,
  add column if not exists starting_academic_year integer,
  add column if not exists gmt_timezone text,
  add column if not exists currency_code text,
  add column if not exists website text,
  add column if not exists facebook_url text,
  add column if not exists twitter_url text,
  add column if not exists instagram_url text,
  add column if not exists youtube_url text,
  add column if not exists cloud_folder_url text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'schools_school_type_check'
  ) then
    alter table public.schools
      add constraint schools_school_type_check
      check (school_type is null or school_type in ('boys', 'girls', 'mixed'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'schools_cycle_type_check'
  ) then
    alter table public.schools
      add constraint schools_cycle_type_check
      check (
        cycle_type is null or cycle_type in (
          'pre_primary', 'primary', 'junior_secondary', 'senior_secondary',
          'tvet', 'college', 'university'
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'schools_ownership_type_check'
  ) then
    alter table public.schools
      add constraint schools_ownership_type_check
      check (
        ownership_type is null or ownership_type in (
          'public', 'private', 'faith_based', 'community_ngo', 'international'
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'schools_institution_type_check'
  ) then
    alter table public.schools
      add constraint schools_institution_type_check
      check (
        institution_type is null or institution_type in (
          'primary_school', 'secondary_school', 'primary_and_secondary',
          'tvet_institute', 'college', 'university'
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'schools_country_code_check'
  ) then
    alter table public.schools
      add constraint schools_country_code_check
      check (country_code is null or country_code ~ '^[A-Z]{2}$');
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'schools_currency_code_check'
  ) then
    alter table public.schools
      add constraint schools_currency_code_check
      check (currency_code is null or currency_code ~ '^[A-Z]{3}$');
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'schools_starting_academic_year_check'
  ) then
    alter table public.schools
      add constraint schools_starting_academic_year_check
      check (starting_academic_year is null or starting_academic_year between 2000 and 2100);
  end if;
end $$;

comment on column public.schools.description is 'Institution description, collected at signup. Optional for historical rows, required by the signup form for new schools.';
comment on column public.schools.school_type is 'Student intake: boys, girls, or mixed. Replaces the generic "Gender" field from the original signup mockup.';
comment on column public.schools.cycle_type is 'Primary education cycle the institution runs, CBC-aligned (pre_primary..university).';
comment on column public.schools.ownership_type is 'Legal/ownership status: public, private, faith_based, community_ngo, international. This is the screenshot''s "Organisation State" field -- confirmed with the requester to mean ownership status, not a geographic state/province.';
comment on column public.schools.institution_type is 'Institution level (primary_school..university) -- distinct from cycle_type (which cycles it runs) and school_type (student intake).';
comment on column public.schools.country_code is 'ISO 3166-1 alpha-2 country code.';
comment on column public.schools.starting_academic_year is 'Academic year the school is onboarding for. Signup form only ever offers the current year or the next one.';
comment on column public.schools.gmt_timezone is 'IANA time zone identifier, e.g. Africa/Nairobi.';
comment on column public.schools.currency_code is 'ISO 4217 currency code the school bills/reports in.';
comment on column public.schools.website is 'Optional, not required at signup.';
comment on column public.schools.facebook_url is 'Optional, not required at signup.';
comment on column public.schools.twitter_url is 'Optional, not required at signup.';
comment on column public.schools.instagram_url is 'Optional, not required at signup.';
comment on column public.schools.youtube_url is 'Optional, not required at signup.';
comment on column public.schools.cloud_folder_url is 'Optional link to an external cloud folder (e.g. Google Drive) for the institution''s documents. Not required at signup.';

-- The signer's salutation ("Your Title" in the screenshot) -- belongs to the
-- person (school_users), not the institution (schools).
alter table public.school_users
  add column if not exists title text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'school_users_title_check'
  ) then
    alter table public.school_users
      add constraint school_users_title_check
      check (
        title is null or title in (
          'Mr', 'Mrs', 'Ms', 'Miss', 'Dr', 'Prof', 'Eng', 'Rev', 'Sheikh', 'Bishop'
        )
      );
  end if;
end $$;

comment on column public.school_users.title is 'Salutation (Mr/Mrs/Dr/...). Optional for historical rows, required by the signup form for a new school owner.';

-- Public bucket for institution logos uploaded at signup (and later editable
-- from Settings -> Branding, which already just treats schools.logo_url as
-- a plain URL string -- see BrandingForm). Public because logo_url is
-- already rendered directly as <img src=...> in public-facing pages
-- (apply/[slug], id-card) with no signed-URL fetch anywhere -- keeping it
-- consistent rather than introducing a second, private-bucket code path.
-- Writes only ever happen server-side via the service-role admin client
-- (signup's server action, and later a branding-upload action), which
-- bypasses RLS entirely, so no INSERT/UPDATE/DELETE storage policy is
-- needed here -- unlike student-documents or application-documents, which
-- are written to from client-facing flows and need real object-level RLS.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'school-logos', 'school-logos', true, 2097152,
  array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
on conflict (id) do nothing;
