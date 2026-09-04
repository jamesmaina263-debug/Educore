-- Second recursion fix: curriculum_strands_select_guardian_student referenced
-- curriculum_sub_strands as a real table, and curriculum_sub_strands' pre-existing
-- staff policy (curriculum_sub_strands_select) references curriculum_strands right
-- back -- a genuine A<->B cycle between the two tables' policies, confirmed by a
-- bare `select id from curriculum_sub_strands` alone recursing even before
-- touching competency_marks. auth_can_view_released_report_card already broke the
-- report_cards/students side of this; this does the same for the
-- curriculum_strands/curriculum_sub_strands side, so curriculum_strands' policy
-- never touches the real (RLS-protected) curriculum_sub_strands table directly.

create or replace function auth_can_view_curriculum_strand(p_strand_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from curriculum_sub_strands css
    join competency_marks cm on cm.sub_strand_id = css.id
    where css.strand_id = p_strand_id
      and auth_can_view_released_report_card(cm.exam_id, cm.student_id)
  );
$$;

revoke execute on function auth_can_view_curriculum_strand(uuid) from public;
grant execute on function auth_can_view_curriculum_strand(uuid) to authenticated;

drop policy curriculum_strands_select_guardian_student on curriculum_strands;
create policy curriculum_strands_select_guardian_student on curriculum_strands for select
using (auth_can_view_curriculum_strand(curriculum_strands.id));
