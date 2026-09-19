-- 2026-09-14 production-readiness audit follow-up: get_student_balance_summary()
-- (deployed 20260909053003, wired into the dashboard the same day this migration
-- was written) was the one SECURITY DEFINER/INVOKER function in the codebase with
-- an unpinned search_path -- flagged by Supabase's own linter. It's SECURITY
-- INVOKER (not DEFINER), so this isn't the privilege-escalation-via-search_path
-- pattern the rest of this codebase already guards against everywhere else
-- (357/357 SECURITY DEFINER functions verified pinned in the 2026-09-14 audit) --
-- but it's the one function that doesn't match house style, and pinning it is
-- free. No behavior change: same query, same access boundary (still bound by
-- v_student_balances' own RLS, evaluated as the calling user).
--
-- Applied directly to production via the Supabase MCP connection during the
-- audit (matches what's live); this file exists so migration-drift-check.yml
-- doesn't flag it as an out-of-band change.

create or replace function public.get_student_balance_summary()
returns table(total_outstanding numeric, students_with_balance bigint)
language sql
stable
set search_path = public
as $function$
  select
    coalesce(sum(greatest(v.balance, 0)), 0) as total_outstanding,
    count(*) filter (where v.balance > 0) as students_with_balance
  from v_student_balances v;
$function$;
