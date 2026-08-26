-- Systematic sweep of every table with a self-scoped (auth.uid()-based) UPDATE RLS
-- policy, looking for the same bug shape already found on school_users: a self-editable
-- row where the RLS check clause doesn't fully constrain which columns can change.
-- Found two more.

-- 1) assignment_submissions_update_own lets a student/guardian update their own
-- submission while status stays 'submitted', but the check clause never constrained
-- grade, feedback, or graded_by -- so a student could set their own grade/feedback
-- (even fabricate graded_by as a real teacher's id) with no academics.write permission
-- at all. The app's legitimate submission path (portal/actions.ts) only ever writes
-- assignment_id, student_id, submission_text, status -- never these three columns --
-- so guarding them breaks nothing.

create or replace function public.prevent_assignment_submission_self_grading()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller_is_grader boolean;
begin
  if auth.uid() is null then
    -- Service-role (admin) client: no user JWT, already bypasses RLS.
    return new;
  end if;

  select exists (
    select 1
    from assignments a
    where a.id = new.assignment_id
      and (
        auth_has_permission('academics.write')
        or a.teacher_id = (select su.id from school_users su where su.auth_user_id = auth.uid())
      )
  ) into v_caller_is_grader;

  if v_caller_is_grader then
    return new;
  end if;

  if new.grade is distinct from old.grade
     or new.feedback is distinct from old.feedback
     or new.graded_by is distinct from old.graded_by then
    raise exception 'insufficient privileges to change grade, feedback, or graded_by';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_assignment_submissions_prevent_self_grading on public.assignment_submissions;

create trigger trg_assignment_submissions_prevent_self_grading
  before update on public.assignment_submissions
  for each row execute function public.prevent_assignment_submission_self_grading();

-- 2) discipline_records_update's WITH CHECK clause was weaker than its USING clause:
-- USING requires (discipline.read_any OR recorded_by = self) AND discipline.write to
-- target a row, but CHECK only required school_id + discipline.write on the new row --
-- dropping the ownership constraint entirely. A staff member with discipline.write but
-- not discipline.read_any could target their own recorded row (passes USING) and then
-- rewrite recorded_by to a different staff member's id, or move the record onto a
-- different student_id/case_id within the school -- an audit-trail integrity gap.
-- No app code currently updates discipline_records directly at all (only inserts, via
-- a separate incident-creation flow), so this closes unused attack surface.

drop policy if exists discipline_records_update on public.discipline_records;

create policy discipline_records_update on public.discipline_records
  for update
  using (
    (school_id = auth_school_id())
    and (
      auth_has_permission('discipline.read_any')
      or (recorded_by = (select su.id from school_users su where su.auth_user_id = auth.uid()))
    )
    and auth_has_permission('discipline.write')
  )
  with check (
    (school_id = auth_school_id())
    and (
      auth_has_permission('discipline.read_any')
      or (recorded_by = (select su.id from school_users su where su.auth_user_id = auth.uid()))
    )
    and auth_has_permission('discipline.write')
  );
