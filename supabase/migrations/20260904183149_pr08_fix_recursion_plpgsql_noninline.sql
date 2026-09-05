-- Third recursion fix. Root cause: `language sql` functions are eligible for
-- planner inlining -- Postgres can flatten a simple SQL function's body directly
-- into the calling query as a rewrite optimization. auth_can_view_curriculum_strand
-- and auth_can_view_released_report_card were both `language sql`, and
-- curriculum_strands <-> curriculum_sub_strands have a genuine two-way policy
-- reference (curriculum_sub_strands_select reads curriculum_strands;
-- curriculum_strands_select_guardian_student's helper reads curriculum_sub_strands).
-- When inlined, that becomes one flattened query where curriculum_strands' own RLS
-- expansion is required to evaluate a subquery that itself requires
-- curriculum_strands' RLS expansion again -- the SECURITY DEFINER role boundary
-- doesn't protect against this because inlining happens as a rewrite step, before
-- the definer's role context would otherwise isolate it.
--
-- The established auth_user_id_is_guardian_of helper never hits this because its
-- dependency graph (student_guardians, school_users) has no cycle back to whatever
-- table calls it. Ours does (curriculum_strands <-> curriculum_sub_strands), so it
-- needs a stronger guarantee than "sql function, security definer" alone provides.
--
-- Fix: `language plpgsql` instead of `language sql`. plpgsql function bodies are
-- opaque to the planner and can never be inlined, so the call is always a genuine
-- separate execution under the definer's role -- which does correctly bypass RLS
-- (confirmed: owner is `postgres`, which has rolbypassrls=true) -- with no
-- possibility of the calling query's policy expansion reaching back into it.

create or replace function auth_can_view_released_report_card(p_exam_id uuid, p_student_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return exists (
    select 1 from report_cards rc
    where rc.exam_id = p_exam_id
      and rc.student_id = p_student_id
      and rc.comment_source = any (array['teacher_approved','teacher_written'])
      and (
        auth_user_id_is_guardian_of(rc.student_id)
        or exists (
          select 1 from students st join school_users su on su.id = st.school_user_id
          where st.id = rc.student_id and su.auth_user_id = auth.uid()
        )
      )
  );
end;
$$;

create or replace function auth_can_view_curriculum_strand(p_strand_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return exists (
    select 1 from curriculum_sub_strands css
    join competency_marks cm on cm.sub_strand_id = css.id
    where css.strand_id = p_strand_id
      and auth_can_view_released_report_card(cm.exam_id, cm.student_id)
  );
end;
$$;
