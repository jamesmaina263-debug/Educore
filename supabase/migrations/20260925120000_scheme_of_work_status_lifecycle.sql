-- Scheme of Work: finish wiring the status lifecycle (spec gap #4).
--
-- Before this migration, draft -> submitted -> approved (or back to draft
-- on return) was the only lifecycle actually wired up. in_progress,
-- under_review and reviewed existed as check-constraint values and dashboard
-- filter options but nothing in the app ever set them.
--
-- Decision (schemes_of_work is empty in production as of this migration --
-- verified via `select status, count(*) from schemes_of_work group by
-- status` returning no rows -- so this is a zero-data-risk change, not a
-- backfill):
--   - in_progress: now real. addSchemeEntry flips a scheme from draft to
--     in_progress the first time a lesson is added (see actions.ts). The
--     Submit button already treated draft and in_progress as equivalent
--     "not yet submitted" states, so this was clearly the intended meaning.
--   - under_review: now real. A reviewer can explicitly start reviewing a
--     submitted scheme (startSchemeReview in actions.ts), mirroring the
--     existing markUnderReviewAction pattern in admissions/actions.ts. This
--     lets a school with more than one reviewer see a scheme is already
--     being looked at. Approve/Return now work from either submitted or
--     under_review.
--   - reviewed: dropped. Nothing in the spec or the existing
--     submit/approve/return flow calls for a distinct "looked at but not
--     yet decided" state beyond under_review, and leaving it in the check
--     constraint with no code path that ever sets it is exactly the dead
--     state the gap asked to either wire up or remove.
alter table schemes_of_work drop constraint schemes_of_work_status_check;
alter table schemes_of_work add constraint schemes_of_work_status_check
  check (status in ('draft', 'in_progress', 'submitted', 'under_review', 'approved'));
