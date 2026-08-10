-- Phase 8, Item 16: Admissions integration. The full onboarding wizard (Section 4.16.9 Step 9)
-- doesn't exist yet — that's Phases 10-13, not started. Admissions today (Phase 1 audit) is a
-- direct status transition on `students` (src/app/admissions/actions.ts: transition()), and
-- activateEnrollment() is the closest existing equivalent to "enrollment completes." This
-- function is the reusable hook that call site is wired to now, AND the same function the future
-- wizard's real Step 9 will call — so this doesn't need to be re-architected when Phase 12
-- builds the wizard, only re-pointed at a richer trigger moment if needed.
-- Gated on students.write (not finance.write) because it's the Admissions Officer completing
-- enrollment, not a Bursar — matches the permission the existing transition() already relies on
-- via RLS on the students table.
create or replace function finance_on_student_enrolled(p_student_id uuid)
returns table (payment_reference text, invoice_id uuid, total_amount numeric)
language plpgsql security definer set search_path = public as $$
declare
  v_school_id uuid := auth_school_id();
  v_account student_financial_accounts;
  v_active_term_id uuid;
  v_invoice_id uuid;
  v_total numeric;
begin
  if not auth_has_permission('students.write') then
    raise exception 'Not authorized to complete enrollment.';
  end if;
  if not exists (select 1 from students where id = p_student_id and school_id = v_school_id) then
    raise exception 'Student not found in your school.';
  end if;

  v_account := get_or_create_student_financial_account(p_student_id);

  select t.id into v_active_term_id from terms t
    join academic_years ay on ay.id = t.academic_year_id
    where ay.school_id = v_school_id and t.status = 'active'
    limit 1;

  if v_active_term_id is not null then
    begin
      v_invoice_id := create_or_get_invoice_for_student(p_student_id, v_active_term_id);
      select total_amount into v_total from invoices where id = v_invoice_id;
    exception when others then
      -- No fee structure configured yet for this student's class/boarding-type — leave the
      -- Financial Account created (so the payment reference exists and can be shown/reused) but
      -- surface no invoice; Finance can generate one manually once a structure is set up. Never
      -- fails the enrollment itself over a Finance configuration gap.
      v_invoice_id := null;
      v_total := null;
    end;
  end if;

  return query select v_account.payment_reference, v_invoice_id, v_total;
end;
$$;

revoke execute on function finance_on_student_enrolled(uuid) from public, anon;
grant execute on function finance_on_student_enrolled(uuid) to authenticated;
