-- Reconstructed from live schema introspection (Supabase project alzqlvfaftwegptfbfej).
-- Original SQL never committed to the repo. Blocks a student/guardian update (permitted while
-- status = 'submitted' by the assignment_submissions_update_own RLS policy) from also sneaking
-- in a change to grade/feedback/graded_by — those fields may only move if the caller is the
-- assignment's teacher or holds academics.write.

CREATE OR REPLACE FUNCTION public.prevent_assignment_submission_self_grading()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

DROP TRIGGER IF EXISTS trg_assignment_submissions_prevent_self_grading ON public.assignment_submissions;
CREATE TRIGGER trg_assignment_submissions_prevent_self_grading
  BEFORE UPDATE ON public.assignment_submissions
  FOR EACH ROW EXECUTE FUNCTION prevent_assignment_submission_self_grading();
