-- Dashboard perf: the finance dashboard's outstanding-balance widget was doing
-- `.from("v_student_balances").select("balance")` with NO filter -- fetching one row
-- PER STUDENT (each row itself computed via 4 LATERAL aggregate subqueries over that
-- student's invoices/discounts/payments/reversals) just to sum() and .filter().length
-- two numbers in JS. At a few hundred students that's tolerable; at the audit's stated
-- scale target (1,000+ students per school) it's re-running that whole per-student
-- computation, every dashboard load, for every finance-permission user, only to throw
-- away everything except a total and a count.
--
-- Deliberately a PLAIN function (no SECURITY DEFINER): v_student_balances is itself
-- security_invoker=true, and the underlying invoices/payments/discounts RLS embeds
-- `finance.read` alongside school_id plus separate guardian/self-staff branches --
-- not just a school_id check. A SECURITY DEFINER wrapper would bypass all of that and
-- would need to reimplement it by hand to stay equivalent. Staying invoker-executed
-- means this inherits the exact same access boundary the old JS-side query relied on,
-- with zero risk of quietly widening it.
create or replace function public.get_student_balance_summary()
returns table(total_outstanding numeric, students_with_balance bigint)
language sql
stable
as $$
  select
    coalesce(sum(greatest(v.balance, 0)), 0) as total_outstanding,
    count(*) filter (where v.balance > 0) as students_with_balance
  from v_student_balances v;
$$;

grant execute on function public.get_student_balance_summary() to authenticated;
