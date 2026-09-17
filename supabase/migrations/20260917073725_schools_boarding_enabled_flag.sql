-- Per-school switch to hide/disable the Boarding module for schools that don't offer boarding.
-- Defaults to true so every existing and future school keeps Boarding exactly as it works
-- today; only a school explicitly flipped to false loses the nav entry, the admissions
-- wizard's Boarding step, and access to /boarding/* pages. This never touches any boarding
-- table, RLS policy, or route -- it only gates visibility/reachability per school and never
-- deletes or alters any tenant's boarding data.
alter table public.schools add column boarding_enabled boolean not null default true;
