# PR-03 / PR-04 — Timetable evidence (GTM Readiness Protocol)

Date: 2026-09-03
Test learner: PR01 TestLearner, admission #734, Demo Academy, stream "5 North"
Test teacher: Test Teacher (Demo Academy)

## PR-03 — Create and display a student timetable
**DoD:** The test learner can view the correct timetable.

**Before this evidence pass:** 0 `timetable_slots` rows existed anywhere near this
student's stream, and even had they existed, the guardian portal (`src/app/portal/page.tsx`)
only rendered the timetable widget `if (roleName === "student")` — a guardian viewing
their child's page never saw it at all. This student has no login of its own
(guardian-only), so PR-03 was structurally unreachable for this test case, contrary to
the tracker's "In Progress" status.

**Real bug found and fixed during this pass:** once slots were seeded and the portal
gating fixed, the guardian-scoped query still returned every subject name as `null`.
Root cause: `subjects`, `classes` and `streams` RLS policies had no guardian/student
read branch at all (staff-with-permission or super-admin only) — a PostgREST embed of
`subjects(name)` under RLS silently drops to null when the embedded table denies read
access, so any real school using timetables today would show every guardian and
student a timetable with blank subject names. Fixed via migration
`20260903071647_pr03_subjects_classes_streams_guardian_student_read.sql`, adding a
guardian/student read branch to all three tables (curriculum reference data only, not
sensitive — scoped to same-school membership via a real student link, mirroring the
existing `timetable_slots_select` pattern).

**Evidence (guardian-scoped simulated session, auth_user_id
003c1395-7988-4d85-b240-e9f76e62b204):**
```
day_of_week | period | start_time | subject_name
1           | 9      | 13:10      | English
1           | 10     | 13:50      | Mathematics
2           | 9      | 13:10      | English
2           | 10     | 13:50      | Mathematics
3           | 9      | 13:10      | English
3           | 10     | 13:50      | Mathematics
4           | 9      | 13:10      | English
4           | 10     | 13:50      | Mathematics
5           | 9      | 13:10      | English
5           | 10     | 13:50      | Mathematics
```
Confirmed correct after the fix (was all-null before it). Portal code change: broadened
both the data fetch and the render condition in `portal/page.tsx` from
`roleName === "student"` to `selected?.current_class_id` (resolved for both parent and
student roles), so guardians now see the same "Today" timetable panel students do.

**Status:** Ready for Review. Remaining gap: the panel only shows *today's* slots, not
a full weekly view — matches the pre-existing code comment that "the Timetable UI
itself was deferred in Phase 1 (schema only)." Worth a founder call on whether a
today-only guardian view meets the intended spirit of PR-03, or whether a full
weekly-grid guardian view should be built.

## PR-04 — Create and display a teacher timetable
**DoD:** The test teacher can view assigned lessons without clashes.

**Evidence (teacher-scoped simulated session, auth_user_id
bb009d6c-4657-4cdd-9df7-34b582296a38):** full 5-day, 8-period-per-day schedule
retrieved with no duplicate (day, period) pairs — confirmed programmatically, zero
clashes across 50 slots spanning 2 streams ("North", "South").

**Status:** Data-and-access confirmed via the existing academics-admin timetable page
(`academics/timetable`), which teachers can reach because `teacher` has `academics.read`
by default. Gap worth flagging: there is no dedicated "my schedule" teacher view — a
teacher must use the same admin-facing, stream-by-stream page as an academic
coordinator to find their own lessons. Meets the DoD as written (they *can* view it),
but a personalized view would be a real product improvement, not just evidence-gathering.
