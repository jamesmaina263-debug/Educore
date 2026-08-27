-- Finding (exams/report cards module review): post-close mark correction is a
-- deliberate, properly-guarded feature -- enforce_marks_lock() blocks new marks
-- on a closed exam and requires a genuinely non-empty edit_reason (DB-enforced
-- via a trigger, not just a UI convention) for any correction. A prior fix
-- (20260817041535) already made class_rankings auto-recompute after such a
-- correction, since report cards and the parent portal read rankings directly
-- and would otherwise show a stale average/rank.
--
-- That fix didn't extend to the report card's own approval state. report_cards
-- reads subject marks LIVE (by design -- see its table comment: "already locked
-- after exam close, so this doesn't drift"), but a mark can legitimately change
-- after that "lock" via the correction path. Nothing resets report_cards.
-- approved_by/approved_at/comment_source when that happens. Consequence: a
-- subject teacher with ordinary marks.write for their own subject can correct
-- a score *after* a class teacher has already approved and published that
-- student's report card (comment_source flips a report card visible to a
-- guardian only once it's 'teacher_approved'/'teacher_written' --
-- 20260801032002). The guardian portal keeps showing the corrected mark
-- immediately (live read) still labelled as approved by the original teacher
-- on the original timestamp -- approval provenance that's no longer true, with
-- no re-review gate before the family sees the changed number.
--
-- Fix, matching the exact pattern already established for rankings: a trigger
-- that fires only on a genuine post-close correction (exam closed, raw_score
-- actually changed) and resets that student's report_cards row for this exam
-- back to unapproved (comment_source='none', approved_by/approved_at=null).
-- This does not delete the existing comment text -- a teacher re-reviewing
-- only needs to look at what's already there and re-approve (or rewrite) it,
-- a light one-click step, not redoing the work. It also correctly re-hides
-- the report card (and, per the existing guardian-visibility policies, that
-- student's exam marks and ranking) from the guardian portal until a human
-- re-confirms it, closing the gap without blocking the legitimate correction
-- workflow.

create or replace function public.report_cards_invalidate_approval_on_mark_correction()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_status text;
begin
  select status into v_status from public.exams where id = new.exam_id;
  if v_status = 'closed' and new.raw_score is distinct from old.raw_score then
    update public.report_cards
    set comment_source = 'none', approved_by = null, approved_at = null
    where exam_id = new.exam_id
      and student_id = new.student_id
      and comment_source in ('teacher_approved', 'teacher_written');
  end if;
  return new;
end;
$$;

revoke all on function public.report_cards_invalidate_approval_on_mark_correction() from public, anon, authenticated;

drop trigger if exists trg_report_cards_invalidate_approval_on_mark_correction on public.marks;
create trigger trg_report_cards_invalidate_approval_on_mark_correction
after update on public.marks
for each row
execute function public.report_cards_invalidate_approval_on_mark_correction();
