# PR-08 — Grades/academic report evidence (GTM Readiness Protocol)

Date: 2026-09-04/05
Test learner: PR01 TestLearner, admission #734, Demo Academy, Grade 5 (CBC model)

## DoD
The correct guardian can access the learner's report securely.

## Real workflow walked end-to-end (not shortcuts)
1. Created a real curriculum strand + sub-strand for Mathematics ("Numbers" →
   "Addition and Subtraction of Fractions").
2. Created exam "Term 3 CAT 1", scoped to the test learner's class.
3. Submitted a CBC competency mark (Meeting Expectation) for the test learner, as
   the test teacher, via `submitCompetencyMarks`'s underlying insert path.
4. Closed the exam via `close_exam()`.
5. Generated report cards via `generate_report_cards()` — 1 row created (only
   active student in this class).
6. Wrote and approved the report-card comment as the school owner — confirmed a
   subject teacher without the `class_teacher`/`school_owner` role cannot do this
   themselves, which appears to be intentional role design (report-card sign-off
   belongs to a class teacher or owner, not any subject teacher), not a bug.

## Real bug found and fixed: same RLS-gap pattern as PR-03, four more tables
Before any fix, the guardian portal's actual queries (`portal/page.tsx`) returned
nothing usable: `exams`, `curriculum_strands`, `curriculum_sub_strands`, and
`grading_scale_bands` had zero guardian/student SELECT policy at all — staff-only.
Confirmed live: the report card row existed and was fetchable, but its embedded
`exams(name)` came back null, and the whole competency-breakdown query (embedding
`grading_scale_bands(label)` and `curriculum_sub_strands(name, curriculum_strands(name))`)
came back empty.

Fixed with new, additive guardian/student read policies (existing staff policies
untouched), scoped — deliberately more tightly than PR-03's fix — to "only once a
report card has actually been released" (`comment_source in
('teacher_approved','teacher_written')`), matching the precedent already correctly
set by `competency_marks` and `class_rankings`'s own policies, via the existing
`auth_user_id_is_guardian_of()` helper.

## A genuinely difficult RLS recursion bug, and how it was actually resolved
The straightforward fix (raw `EXISTS` subqueries referencing the shared tables
directly in each new policy) caused real `infinite recursion detected in policy`
errors — confirmed by testing, at three successively deeper layers:

1. **`curriculum_strands` ↔ `curriculum_sub_strands`**: a genuine two-way cycle —
   `curriculum_sub_strands`'s *pre-existing* staff policy references
   `curriculum_strands`, and my new `curriculum_strands` policy referenced
   `curriculum_sub_strands` right back.
2. Wrapping the report-card check in a `language sql security definer` helper
   didn't fully fix it: `language sql` functions are eligible for planner
   inlining, which can flatten the security-definer boundary back into the same
   recursive query tree. Switched every helper to `language plpgsql` (never
   inlined by the planner), which is a real, load-bearing distinction — not
   cosmetic.
3. Even after that, a **third, previously-invisible policy** was found:
   `competency_marks_write_own` (a `FOR ALL` policy — meaning it also
   contributes to SELECT visibility, not just writes) independently references
   `curriculum_sub_strands`/`curriculum_strands` to check a teacher's own
   subject/stream assignment. My new `curriculum_sub_strands` and
   `grading_scale_bands` policies were still querying `competency_marks` as a
   raw real table (not through a function), which pulled in *all* of
   `competency_marks`' policies — including this one — closing the loop. Fixed
   by wrapping that lookup in two more `plpgsql security definer` helper
   functions (`auth_can_view_sub_strand_marks`, `auth_can_view_grading_band_marks`),
   so no policy in this chain ever touches another RLS-protected table as a raw
   reference — every cross-table check goes through a non-inlinable, RLS-bypassing
   function call.

Final state verified directly, not assumed: a bare `select` against each of the
four tables individually, then the full combined guardian-scoped queries exactly
as `portal/page.tsx` issues them (report card + exam name; full competency
breakdown with band/strand/sub-strand/subject names) — all return correct data.
Re-verified staff access (school owner) still works unchanged on all four tables
afterward.

## Compatibility with concurrent work
While this was in progress, PR #247 ("Redesign report card around achievement +
competency + strengths/support", Step 10 of the Performance Appraisal Engine
directive) landed on `main`, adding a new guardian-facing query against
`competency_indicator_ratings`/`competency_indicators`. Checked both: already
correctly guardian-scoped (`competency_indicator_ratings`) or globally readable by
design (`competency_indicators`, all 19 rows have `school_id is null`) — no
additional fix needed there, and no conflict with this PR (no source files
overlap; this PR is migrations-only).

## Status
Ready for Review. No device-level test needed for this item (unlike PR-14/OS-01/OS-02/
OS-03) — fully verified via simulated-JWT sessions against the real, live schema.
