-- Part 17. competency_evidence had 2 ALL-cmd permissive policies (write_any
-- + write_own); merged. The separate competency_evidence_select policy is
-- left untouched -- an ALL policy already also applies to SELECT alongside
-- it, so this reduces SELECT from 3 applicable policies to 2, and
-- INSERT/UPDATE/DELETE from 2 to 1; a full reduction to 1-for-everything
-- would require splitting the ALL policy into 4 action-specific ones, a
-- bigger structural change intentionally left for a separate pass (see
-- supabase/.rls_coverage_allowlist / the audit report for the list of
-- tables still carrying this residual ALL+SELECT overlap:
-- competency_evidence, competency_indicator_ratings, competency_indicators,
-- competency_marks, remark_bank_entries, role_permissions,
-- rubric_criterion_scores, plus applications, roles, school_groups,
-- staff_attendance, subject_catalogue which were never touched this round).
-- Applied directly to production via Supabase MCP during the audit and
-- verified live.
drop policy competency_evidence_write_any on public.competency_evidence;
drop policy competency_evidence_write_own on public.competency_evidence;
create policy competency_evidence_write on public.competency_evidence
  for all
  using (
    (school_id = auth_school_id() and auth_has_permission('marks.write_any'))
    or (
      school_id = auth_school_id()
      and auth_has_permission('marks.write')
      and exists (
        select 1 from competency_marks cm
        join students st on st.id = cm.student_id
        join curriculum_sub_strands css on css.id = cm.sub_strand_id
        join curriculum_strands cst on cst.id = css.strand_id
        where cm.id = competency_evidence.competency_mark_id
          and auth_user_teaches_subject_in_stream(st.current_class_id, cst.subject_id)
      )
    )
  )
  with check (
    (school_id = auth_school_id() and auth_has_permission('marks.write_any'))
    or (
      school_id = auth_school_id()
      and auth_has_permission('marks.write')
      and exists (
        select 1 from competency_marks cm
        join students st on st.id = cm.student_id
        join curriculum_sub_strands css on css.id = cm.sub_strand_id
        join curriculum_strands cst on cst.id = css.strand_id
        where cm.id = competency_evidence.competency_mark_id
          and auth_user_teaches_subject_in_stream(st.current_class_id, cst.subject_id)
      )
    )
  );
