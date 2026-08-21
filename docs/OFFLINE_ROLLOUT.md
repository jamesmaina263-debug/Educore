# Offline support rollout

## Cross-module offline navigation (this pass)

Every module above solved *writing* while offline. This pass solves a
different problem: **before this, you could only stay on the one page you
had open when you went offline -- clicking any sidebar link, breadcrumb,
the command palette, or a `g <letter>` shortcut just silently failed**,
because they all did Next.js's normal client-side "soft" navigation, which
fetches an RSC payload straight from the server. There's no cache in front
of that fetch, by design (see `public/sw.js`'s original scope note), so it
had nothing to fall back to.

Two changes, kept deliberately separate so the risky part (caching
per-school/per-user data) stays small and easy to reason about:

- **`public/sw.js`** now caches two different things, on two different
  strategies:
  - Full-document page navigations (`RUNTIME_CACHE`) -- network-first, so
    the freshest copy is always used when online, falling back to the last
    successful visit when offline. This **does** contain rendered
    per-school/per-user data (whatever that page's Server Component fetched
    at cache time).
  - `/_next/static/*` build chunks (`STATIC_CACHE`) -- cache-first. These
    are content-hashed by Next's build and contain no tenant data at all, so
    caching them aggressively and keeping them across sign-outs is safe;
    it's also what lets a cached page actually hydrate (be interactive, not
    just display static HTML) while offline.
  - `CACHE_VERSION` bumped (`v2` -> `v3`) so every device's old caches are
    wiped on next activate, rather than mixing old and new caching logic.
- **`src/lib/offline/clear-on-logout.ts`** -- wipes `RUNTIME_CACHE` (via a
  `postMessage` to the service worker) and the `cached_reads` IndexedDB
  store on every sign-out. Wired into the one place `onSignOut` is actually
  invoked (`topbar.tsx`'s dropdown), so every page that renders `AppShell`
  is covered without touching two dozen call sites individually. This is
  the actual answer to "won't this leak data across schools/users on a
  shared device" -- a cached page cannot outlive the session that cached it.
  Deliberately does **not** touch `pending_mutations` -- a queued offline
  write belongs to the device, not the session, and discarding it on
  sign-out would be a data-loss bug, not a safety fix.
- **Navigation call sites forced to a hard (real) browser navigation while
  offline**, since only a real navigation goes through the service worker's
  `fetch` handler above (a soft `<Link>`/`router.push()` transition never
  does): `sidebar-nav.tsx` (both top-level and nested items),
  `breadcrumbs.tsx`, `command-palette.tsx`, `go-to-shortcuts.tsx` (the
  `g <letter>` shortcuts), and the sidebar's school-name/logo link in
  `app-shell-frame.tsx`. Online, every one of these is completely
  unchanged -- soft navigation stays as fast as it already was; the hard-
  navigation branch only runs when `useOnlineStatus()` reports offline.
- **`app-shell-frame.tsx`** shows one app-wide "you're offline, pages may
  not show the latest data" banner (distinct from each module's own
  offline-*write* banner, e.g. attendance/exams -- this one is about what
  you're *reading*, not what you're about to submit).

**What this does not do:** it doesn't make an unvisited page reachable
offline (there's nothing to serve a cache miss from), and it doesn't
background-prefetch every module preemptively -- a page becomes available
offline only after being visited at least once while online. It also
doesn't yet expose "cached as of [time]" per page; the app-wide banner is a
blunter signal for now. Both are reasonable, scoped follow-ups if staleness
turns out to be confusing in practice.

Verified: `tsc --noEmit`, `eslint`, and `vitest run` all pass on the
touched files. Not yet verified: an actual airplane-mode walkthrough in a
real browser (visit a few modules online, go offline, confirm navigation
between them works and stale-page warning shows, sign out, confirm a
second sign-in doesn't see the first user's cached pages) -- recommended
before relying on this in production, since service worker caching
behavior is one of the harder things to fully verify without a real
browser.

## What changed in this pass

Attendance was the only module with offline support, and it was built as a
one-off (its own IndexedDB store, its own queue functions, its own sync
hook). This pass pulled that into a **generic engine** that any module can
plug into, and moved attendance onto it with no behavior change:

- `src/lib/offline/db.ts` -- IndexedDB wrapper. Two shared stores instead of
  one per module: `pending_mutations` (queued writes) and `cached_reads`
  (last-known-good data for the read side, not used yet -- see below).
  Migrates any already-queued v1 `pending_attendance` records into the new
  schema on first load, so upgrading the app can't silently drop a
  not-yet-synced offline submission.
- `src/lib/offline/queue.ts` -- `queueMutation()`, `getPendingMutations()`,
  `syncPendingMutations()`. Module-agnostic.
- `src/lib/offline/handlers.ts` -- the dispatch table. One line per queued
  mutation type, mapping it to the exact Server Action the online path
  already calls. This is the only file a new module needs to touch in the
  engine itself.
- `src/hooks/use-offline-sync.ts` -- `useOfflineSync(module)`: online status,
  pending count, failed items, syncing state, manual retry, discard. Auto-syncs
  on reconnect. For future modules to use directly.
- `src/lib/offline/attendance-queue.ts` is now a thin wrapper over the above
  (same exported function names/shapes, including `discardFailedSubmission`).
  `src/hooks/use-attendance-sync.ts` and `register-form.tsx` were **not**
  touched -- they already worked correctly against those same function names,
  so there was nothing to change there.
- `src/lib/offline/queue.test.ts` -- behavioral tests against a real (fake)
  IndexedDB: queue/sync happy path, error handling, per-module scoping, and
  the v1->v2 migration.

Verified: `tsc --noEmit`, `eslint`, and `vitest run` all pass. (Production
`next build` wasn't run here since it needs live Supabase env vars this
sandbox doesn't have -- run it once before deploying.)

## Two different action shapes in this codebase

Surveying every module's `actions.ts`:

- **Typed-object actions** (`submitAttendance(input: {...})`, most of
  health, exams, library, inventory's create/update actions) -- these queue
  into the engine above with no changes needed. This is the majority.
- **`FormData`-based actions** (`discipline/actions.ts` is entirely this
  shape; a couple of inventory actions too) -- these need a small adapter
  before they can be queued, because some of these forms may carry file
  attachments (e.g. a discipline report's evidence), and file survival
  through IndexedDB-then-replay isn't something to assume works without
  checking each form. Recommend converting these actions' inputs to a plain
  typed object (dropping file uploads, or handling them as a separate
  always-online step) on a case-by-case basis rather than queuing raw
  `FormData`.

## Per-module checklist (typed-object actions)

This is exactly what attendance already does -- copy the pattern:

1. **`src/lib/offline/handlers.ts`** -- import the action, add
   `"<module>:<actionName>": actionName as MutationHandler`.
2. **The client form component** -- mirror `register-form.tsx`:
   - `const { online, pendingCount, syncing, sync } = useOfflineSync("<module>");`
   - In the submit handler: if `!online`, call
     `queueMutation("<module>", "<actionName>", input)` instead of calling
     the action directly, and track queued-but-unconfirmed rows in local
     state (separate from confirmed data) so the UI can show them as
     "saved offline -- will sync".
   - Show the offline banner / pending-sync banner (copy the two `panel`
     blocks near the top of `register-form.tsx`).
   - When `online && pendingCount === 0` transitions after having queued
     something, `router.refresh()` so confirmed server data replaces the
     locally-queued rows.
3. **Read side** -- if the module's page needs to *render* while offline
   (not just accept writes), cache what it needs via `idbGet`/`idbPut` on
   `STORES.cachedReads` when the fetch succeeds online, and fall back to
   the cached copy when `!online`. Not built yet for any module beyond the
   store existing -- do this only for modules where working from stale data
   is actually useful (e.g. a nurse needs to see the student roster to check
   someone in, even if it's a few hours stale).
4. **Service worker (`public/sw.js`)** -- currently only caches the app
   shell. If a module's page itself needs to load while offline (not just
   its data), that page's route needs adding to the shell's cache list too.

## Progress

- [x] **Attendance** -- write queueing (`submitAttendance`), plus discard for
  permanently-failed items.
- [x] **Health** -- write queueing for `checkInStudent`, `checkOutStudent`,
  `administerMedication`, `logEmergency`, `createReferral`. All 4 write
  forms (sick bay, medication, emergencies, referrals) share one "health"
  module queue and one shared banner component
  (`src/components/health/offline-banner.tsx`), so a nurse sees one
  consistent "N entries waiting to sync" count regardless of which tab
  she's on.

  Deliberately **not** queued:
  - `updateReferralOutcome` -- an update to an existing record with no
    strong "must happen right now, in the field" need; a desk follow-up
    task once back online.
  - `sendHealthAlertAction` -- dispatches an actual guardian notification.
    Queuing a "the SMS is sent" action silently for later means the
    nurse's screen would say "sent" only once synced, with no way to tell
    the guardian in the moment that the message hasn't gone out yet. That
    needs its own delayed-delivery UX, not a silent replay -- left online-only
    for now.
  - Medical-inventory admin actions (`addMedicalInventoryItem`,
    `issueMedicalStock`, `acceptTransferAction`, `rejectTransferAction`) --
    desk-based bookkeeping, not field work under time pressure.

  **Known tradeoff, documented rather than silently accepted:**
  `administerMedication` can deduct from tracked medical inventory. If
  queued offline, that deduction only happens once the mutation actually
  syncs -- so the stock count shown during an outage won't reflect doses
  given but not yet synced. Two nurses (or one nurse across two offline
  sessions) could theoretically both believe there's enough stock for a
  dose that's already been used. Same category of risk as attendance's
  race on a duplicate submission (both are resolved by the server's real
  check running at sync time, not blindly trusted client-side) -- but
  worth knowing about specifically here since it's inventory, not just a
  record.

  Queued items intentionally do **not** appear in the sick-bay/medication/
  emergency/referral tables until they've actually synced -- there's no
  local row to show for something that only exists in this device's
  IndexedDB. The banner ("N entries waiting to sync") is what confirms the
  submission was captured in the meantime.

- [x] **Boarding** -- write queueing for `submitRollCall` and `logIncident`.
  Same shared-banner pattern as health, its own "boarding" module queue
  (`src/components/boarding/offline-banner.tsx`).

  `submitRollCall` also takes positional args (`date, session, entries`)
  rather than a single object -- same adapter pattern used for
  `checkOutStudent`, with its own dedicated args-ordering test.

  Deliberately **not** queued: house/dormitory/room/bed structure setup,
  `allocateStudentToBed` / `endAllocation` / `transferStudent`, and
  `updateIncidentStatus` -- all desk-based admin actions, not the
  dorm-floor, possibly-no-signal work roll call and incident logging are.

- [x] **Admissions (partial, by design)** -- write queueing for exactly 3 of
  the wizard's ~20 actions: `updateAdmissionDetails`, `updateApplicantIdentity`,
  `saveHealthProfileForApplication`. This module is structurally different
  from the three above, and the scope reflects that rather than forcing the
  same pattern where it doesn't fit:

  The admissions wizard is a **live, sequential, interdependent flow** --
  the code comment on `createOrLinkStudent` literally says "the Student
  record is created for real at step 2." Most of its actions genuinely
  need a fresh connection to be safe or meaningful:
  - `checkForDuplicateStudents` / `createOrLinkStudent` -- duplicate
    detection has to run against current server data; queuing a blind
    "create student" against possibly-stale duplicate-check results risks
    creating real duplicate student records.
  - `searchGuardians` / `linkGuardianToApplication` -- live search, no
    offline value without results to select from.
  - `uploadDocumentAsStaff` -- `FormData` with a file, same caveat as
    discipline (not queued anywhere in this rollout yet).
  - `allocateBoardingForApplication` / `assignTransportForApplication` --
    same desk-based-assignment reasoning as boarding's bed/transport
    actions, kept online-only for consistency.
  - `getFeePreview` / `saveFinanceDecision` / `getAdmissionChecklist` /
    `completeEnrollmentAction` -- the final commit step of the whole
    wizard, converting an application into a real enrolled student. This
    is the single highest-risk action in the app to run against stale
    offline state; it must run live, every time.

  What genuinely doesn't have that dependency -- three plain field saves
  (Admission Details, Applicant Identity, Health Profile step) -- are
  queued through the same engine as everything else, with their own
  banner (`src/components/admissions/offline-banner.tsx`) that says so
  explicitly: *"these steps are captured offline; the rest of the wizard
  needs a connection."* An admissions officer who loses signal mid-wizard
  doesn't lose typed-in data on those specific steps, but still can't
  finish enrolling a student until they're back online -- which was
  already true before this change, and isn't something a write-queue can
  safely fix.

  `updateAdmissionDetails` and `updateApplicantIdentity` both take
  `(applicationId, input)` -- two args, not one object -- same adapter
  pattern as `checkOutStudent` / `submitRollCall`, with its own test.

- [x] **Library** -- write queueing for `issueLoanAction`,
  `issueLoanToStaffAction`, `returnLoanAction`, `markLoanLostOrDamagedAction`.
  All 4 live in one component (`LibrarySection`) and share one "library"
  module queue/banner. `returnLoanAction(id)` takes a single positional
  string, not an object -- same adapter pattern as `checkOutStudent`, with
  its own test.

  Known tradeoff, same category as `administerMedication`'s: marking a
  loan "lost" also permanently deducts a copy from the collection, but
  only once the mutation actually syncs -- the copy count shown during an
  outage won't reflect it until then.

  Deliberately **not** queued: `createLibraryItemAction` /
  `adjustCopiesAction` (desk cataloguing), `createShelfAction` /
  `createReservationAction` / `createFineAction` (`FormData`),
  `cancelReservationAction` / `resolveFineAction` (desk follow-up).

- [x] **Inventory** -- write queueing for `recordStockMovementAction` only
  (the literal "stock movement" this rollout order named). Typed-object,
  RPC-backed, no adapter needed.

  Deliberately **not** queued: `createInventoryItemAction` /
  `createCategoryAction` (desk cataloguing), `createTransferAction`
  (desk-initiated, same reasoning as boarding's `transferStudent`), and
  everything asset/procurement-related (`FormData`, desk/office workflows).

- [x] **Discipline** -- the `FormData` decision from earlier is resolved:
  inspecting every discipline form turned up **no file inputs at all** --
  the module uses `FormData` purely as a form-submission convention (React
  19's native `<form action={fn}>`), not because anything uploads a file.
  That changes the risk profile completely from what was assumed earlier
  in this doc.

  New pattern, `src/lib/offline/form-data.ts`: `formDataToObject()` /
  `objectToFormData()` convert a `FormData` submission to a plain string
  map and back. This is necessary (not just convenient) because FormData
  itself isn't structured-cloneable -- `idbPut()`-ing one directly throws
  `DataCloneError` -- so every FormData-based mutation needs this
  round-trip before it can be queued at all. `formDataToObject()` throws
  loudly (rather than silently dropping the field) if it ever encounters a
  `File`, so a future FormData-based module with a real file input can't
  silently lose an attachment through this path -- it'll fail fast in
  testing instead.

  Queues: `createIncidentAction`, `addDisciplinaryActionAction`,
  `createCaseAction`, `createWelfareConcernAction`,
  `createSafeguardingReportAction`. All 5 share discipline's existing
  central `runAction()` dispatcher (already used by every form in the
  module) -- it now takes an optional `mutationType` string; passing one
  makes that specific call offline-queueable, omitting it leaves the
  original online-only behavior unchanged. `createSafeguardingReportAction`
  is included deliberately, same reasoning as `logEmergency` in health: a
  safeguarding concern should never be lost to a dropped connection, and
  capturing it immediately (even offline) is more protective of the child
  than risking it not getting filed at all.

  Deliberately **not** queued: `updateCaseAction` / `updateWelfareConcernAction`
  / `updateSafeguardingReportAction` -- status/follow-up updates, desk-based
  like every other `update*` action excluded elsewhere in this rollout.

- [x] **Staff attendance** -- queues `submitStaffAttendance` (typed-object,
  same shape as student attendance's `submitAttendance`, right down to the
  unique-constraint-on-first-marking pattern). `staff-register-form.tsx`
  replicates `register-form.tsx`'s queued-marks-merge UX (a local `queued`
  state, kept separate from `draft`, so a submitted-while-offline row can't
  be double-submitted and disappears from "to mark" without yet claiming to
  be server-confirmed).

  Deliberately **not** queued: `editStaffAttendanceRecord` -- a correction,
  desk follow-up like every other `edit`/`update` action excluded
  elsewhere in this rollout.

  Found via the same audit that ruled out transport (see below) -- worth
  noting since it shows the audit process finds real wins, not just
  exclusions.

- [x] **Exams -- marks entry.** Queues `submitMarks` (numeric/CBC subject
  marks, `marks-entry-form.tsx`) and `submitCompetencyMarks` (sub-strand
  ratings, `competency-marks-section.tsx`). Both are exactly the "teacher in
  a classroom or exam hall, entering results with unreliable Wi-Fi"
  scenario this rollout targets. Both write forms share one `"exams"` queue
  and one banner (`components/exams/offline-banner.tsx`, same shape as
  health's), so a teacher moving between the numeric-marks table and the
  CBC competency grid on the same page sees one consistent pending/failed
  count. Same queued-state-separate-from-draft UX as attendance and staff
  attendance: a row submitted offline shows "Saved offline" and drops out
  of "to enter" without claiming to be server-confirmed until the roster
  refresh after sync picks it up as `existing`.

  Deliberately **not** queued: `editMark` / `editCompetencyMark`
  (corrections -- desk follow-up, same category as every other
  `edit`/`update` action excluded elsewhere), and the exam/grading-scale/
  schedule/curriculum-strand setup actions (`createExam`, `closeExam`,
  `reopenExam`, `createGradingScale`, `setClassGradingScale`,
  `saveExamSchedule`, `deleteExamSchedule`, `createCurriculumStrand`,
  `createCurriculumSubStrand`, `approveMarks`) -- all desk-based admin
  configuration, not the classroom/exam-hall marks entry the two handlers
  above cover. If a closed exam needs a correction while offline, the UI
  now says so explicitly rather than silently dropping it or queuing
  something that would need a reason prompt it can't safely defer.

## Next up

Given "both spotty connections and full dead zones happen regularly," the
remaining highest-value modules are the ones where someone is physically
away from a router doing time-sensitive data entry:

1. ~~Health / sick bay~~ -- done, see above.
2. ~~Boarding roll call~~ -- done, see above.
3. ~~Admissions~~ -- done (partial, by design), see above.
4. ~~Library loans / inventory stock movements~~ -- done, see above.
5. ~~Discipline~~ -- done, see above.
6. **Transport -- audited, nothing to do here.** All 5 of its actions
   (`createRouteAction`, `createVehicleAction`, `createStopAction`,
   `assignTransportAction`, `endTransportAssignmentAction`) turned out to
   be desk/office setup and assignment work -- defining routes, registering
   vehicles (with license/insurance/inspection expiry fields, clearly
   paperwork), assigning a student to a route. There's no daily trip log,
   no "student boarded" tracking, no driver check-in -- nothing
   representing actual in-transit field activity. Under the same criteria
   applied to every module above, none of these qualify. **Don't re-audit
   this one** unless a real trip-logging feature gets added later.
7. ~~Staff attendance~~ -- done, see above (added alongside this entry).
8. ~~Exams -- marks entry~~ -- done, see above.

Not yet reviewed: academics, finance, homework, payroll, performance,
pt-meetings, reports, students, communication, campuses, settings, admin,
ai, dashboard. None of these have an obviously-field time-pressured
candidate the way marks entry or roll call did -- each still needs its own
audit rather than an assumption either way. Transport looked promising
from the module name too, until the audit showed otherwise.

Each module should get its own review pass (this checklist, then a real
device/offline test) rather than being batch-applied -- that's what keeps
"don't break what's already working" true as this expands.
