-- Fourth recursion fix. Found the actual remaining cycle: competency_marks has a
-- SECOND policy I hadn't accounted for, `competency_marks_write_own` (FOR ALL,
-- so it also contributes to SELECT visibility, not just INSERT/UPDATE/DELETE),
-- which references curriculum_sub_strands and curriculum_strands directly as real
-- tables (checking a teacher's own subject/stream assignment). My
-- curriculum_sub_strands_select_guardian_student and
-- grading_scale_bands_select_guardian_student policies still queried
-- competency_marks as a raw real table (not through a function), so evaluating
-- them pulled in ALL of competency_marks' policies -- including
-- competency_marks_write_own -- which references curriculum_sub_strands/
-- curriculum_strands right back. Same fix pattern as before: wrap the
-- competency_marks lookup in a plpgsql SECURITY DEFINER function so it never
-- triggers competency_marks' own RLS expansion at all.

create or replace function auth_can_view_sub_strand_marks(p_sub_strand_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return exists (
    select 1 from competency_marks cm
    where cm.sub_strand_id = p_sub_strand_id
      and auth_can_view_released_report_card(cm.exam_id, cm.student_id)
  );
end;
$$;

create or replace function auth_can_view_grading_band_marks(p_band_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return exists (
    select 1 from competency_marks cm
    where cm.band_id = p_band_id
      and auth_can_view_released_report_card(cm.exam_id, cm.student_id)
  );
end;
$$;

drop policy curriculum_sub_strands_select_guardian_student on curriculum_sub_strands;
create policy curriculum_sub_strands_select_guardian_student on curriculum_sub_strands for select
using (auth_can_view_sub_strand_marks(curriculum_sub_strands.id));

drop policy grading_scale_bands_select_guardian_student on grading_scale_bands;
create policy grading_scale_bands_select_guardian_student on grading_scale_bands for select
using (auth_can_view_grading_band_marks(grading_scale_bands.id));

-- auth_can_view_curriculum_strand's own body reads competency_marks raw too --
-- same exposure, same fix, for consistency and correctness even though it
-- already tested clean above (that test didn't have a row to find, so the
-- EXISTS short-circuited before ever touching competency_marks -- not a real
-- guarantee).
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
    where css.strand_id = p_strand_id
      and auth_can_view_sub_strand_marks(css.id)
  );
end;
$$;
