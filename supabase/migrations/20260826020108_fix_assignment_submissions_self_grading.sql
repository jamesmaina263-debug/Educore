-- assignment_submissions_update_own lets a student/guardian update their own submission
-- while status stays 'submitted', but the RLS check clause never constrains grade,
-- feedback, or graded_by -- so a student could set their own grade/feedback (even
-- fabricate graded_by as a real teacher's id) directly, with no academics.write
-- permission at all. The app's legitimate submission path (portal/actions.ts) only ever
-- writes assignment_id, student_id, submission_text, status -- never these three columns
-- -- so guarding them breaks nothing.

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
