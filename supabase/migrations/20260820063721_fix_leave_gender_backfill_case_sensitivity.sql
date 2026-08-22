-- Fix: the restricted_gender backfill in 20260820062831_leave_gender_restriction.sql matched
-- leave_types.name with an exact, case-sensitive comparison ('Maternity Leave' / 'Paternity
-- Leave'). That missed Demo Academy's rows, which are named 'Maternity leave' / 'Paternity
-- leave' (lowercase 'l') -- seeded by an untracked migration applied directly to the database
-- outside of git at some point before this session (same recurring gap this repo's history
-- already calls out: work applied live via the Supabase MCP tool but never checked into git).
-- Re-run the backfill case-insensitively so it actually reaches every school, not just ones
-- whose leave types happen to match this codebase's exact capitalization convention.

update public.leave_types
set restricted_gender = 'female'
where lower(name) = 'maternity leave' and restricted_gender is null;

update public.leave_types
set restricted_gender = 'male'
where lower(name) = 'paternity leave' and restricted_gender is null;
