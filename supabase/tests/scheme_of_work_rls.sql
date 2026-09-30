-- Behavioral RLS test for the scheme_of_work module.
--
-- Phase 4 verification-gaps item: "consider how to get RLS coverage into
-- the actual CI-run test suite rather than one-off manual verification."
-- The existing supabase/.rls_coverage_allowlist + scripts/check_rls_coverage.py
-- (run by .github/workflows/rls-coverage-check.yml) only check a STRUCTURAL
-- property -- RLS is enabled on a table and its policies reference
-- auth_school_id()/auth_is_super_admin() somewhere in their SQL text. That
-- says nothing about whether the policy actually behaves correctly. This
-- file is the behavioral half: it runs the actual boundary decisions a real
-- request would hit, as the real roles that would hit them, against the
-- real deployed policies (not a reimplementation of the RLS logic in test
-- code, which could drift from the real policies and pass while the real
-- ones are broken).
--
-- HOW: Postgres RLS's auth.uid() reads a session-local GUC
-- (`request.jwt.claims`), which is exactly what PostgREST sets from a real
-- JWT on every request. Setting it directly with set_config(..., true)
-- ("true" = LOCAL, transaction-scoped) and switching to the `authenticated`
-- role reproduces the same conditions a real signed-in request runs under
-- -- confirmed against this exact live database before this file was
-- written (see PR description), not assumed to work.
--
-- SAFETY: everything after the opening `begin;` happens inside one
-- transaction that ends in `rollback;` -- nothing here is ever persisted,
-- staging or production. The final block re-connects (a fresh implicit
-- transaction, after the rollback above has already completed) and asserts
-- zero fixture rows remain, as a second, independent tripwire in case the
-- rollback above were ever accidentally removed or short-circuited.
--
-- FIXTURES: fully synthetic (freshly generated UUIDs, `@example.invalid`
-- emails) -- this file has zero dependency on what data happens to exist in
-- whichever database it runs against, and never references a real person,
-- school, or account. Run via:
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/scheme_of_work_rls.sql
--
-- WHAT THIS DOES NOT COVER: every RLS-protected table in the app (that's
-- what rls-coverage-check.yml's structural check is for, applied
-- generically); or the server actions' own logic (that's
-- actions-crud-and-ai.test.ts / actions.test.ts, mock-based unit tests).
-- This is specifically the scheme_of_work/scheme_of_work_entries policies,
-- tested behaviorally. Extending this pattern to other modules is future
-- work -- reuse the technique, not this specific fixture set.

begin;

do $$
declare
  v_school_a uuid := gen_random_uuid();
  v_school_b uuid := gen_random_uuid();
  v_teacher_role uuid;
  v_principal_role uuid;
  v_ay_a uuid := gen_random_uuid();
  v_term_a uuid := gen_random_uuid();
  v_class_a uuid := gen_random_uuid();
  v_subject_a uuid := gen_random_uuid();
  v_catalogue_id uuid;
  v_teacher_a_auth uuid := gen_random_uuid();
  v_teacher_a2_auth uuid := gen_random_uuid();
  v_principal_a_auth uuid := gen_random_uuid();
  v_teacher_b_auth uuid := gen_random_uuid();
  v_teacher_a_su uuid := gen_random_uuid();
  v_teacher_a2_su uuid := gen_random_uuid();
  v_principal_a_su uuid := gen_random_uuid();
  v_teacher_b_su uuid := gen_random_uuid();
  v_scheme_id uuid := gen_random_uuid();
  v_entry_id uuid := gen_random_uuid();
  v_new_scheme_id uuid;
  v_count int;
  v_insert_failed boolean;
begin
  -- ---- Fixtures, as this connection's own privileged role (RLS doesn't
  --      apply to a superuser/table-owning role by default; every check
  --      below explicitly switches to `authenticated` first). ----
  select id into v_teacher_role from roles where name = 'teacher';
  select id into v_principal_role from roles where name = 'deputy_principal';
  select id into v_catalogue_id from subject_catalogue limit 1;
  if v_teacher_role is null or v_principal_role is null or v_catalogue_id is null then
    raise exception 'FIXTURE SETUP FAILED: expected roles ("teacher", "deputy_principal") or at least one subject_catalogue row not found -- has the seed data this test depends on changed?';
  end if;

  insert into schools (id, name, slug, application_number_prefix) values
    (v_school_a, 'RLS Test School A', 'rls-test-school-a', 'RTA'),
    (v_school_b, 'RLS Test School B', 'rls-test-school-b', 'RTB');

  insert into auth.users (id, aud, role, email) values
    (v_teacher_a_auth, 'authenticated', 'authenticated', 'rls-test-teacher-a@example.invalid'),
    (v_teacher_a2_auth, 'authenticated', 'authenticated', 'rls-test-teacher-a2@example.invalid'),
    (v_principal_a_auth, 'authenticated', 'authenticated', 'rls-test-principal-a@example.invalid'),
    (v_teacher_b_auth, 'authenticated', 'authenticated', 'rls-test-teacher-b@example.invalid');

  insert into school_users (id, school_id, auth_user_id, role_id, full_name, status) values
    (v_teacher_a_su, v_school_a, v_teacher_a_auth, v_teacher_role, 'RLS Test Teacher A', 'active'),
    (v_teacher_a2_su, v_school_a, v_teacher_a2_auth, v_teacher_role, 'RLS Test Teacher A2', 'active'),
    (v_principal_a_su, v_school_a, v_principal_a_auth, v_principal_role, 'RLS Test Principal A', 'active'),
    (v_teacher_b_su, v_school_b, v_teacher_b_auth, v_teacher_role, 'RLS Test Teacher B', 'active');

  insert into academic_years (id, school_id, name, start_date, end_date) values
    (v_ay_a, v_school_a, 'RLS Test Year', '2026-01-01', '2026-12-31');
  insert into terms (id, school_id, academic_year_id, name, term_number, start_date, end_date) values
    (v_term_a, v_school_a, v_ay_a, 'RLS Test Term', 1, '2026-01-01', '2026-04-01');
  insert into classes (id, school_id, academic_year_id, name, level_order) values
    (v_class_a, v_school_a, v_ay_a, 'RLS Test Class', 1);
  insert into subjects (id, school_id, name, catalogue_id) values
    (v_subject_a, v_school_a, 'RLS Test Subject', v_catalogue_id);

  -- A scheme owned by Teacher A, and one entry under it. Inserted as the
  -- privileged setup role -- INSERT-time RLS is tested separately below,
  -- as Teacher A themself.
  insert into schemes_of_work (id, school_id, academic_year_id, term_id, class_id, subject_id, teacher_id, total_weeks, lessons_per_week)
  values (v_scheme_id, v_school_a, v_ay_a, v_term_a, v_class_a, v_subject_a, v_teacher_a_su, 3, 2);
  insert into scheme_of_work_entries (id, scheme_id, week_number, lesson_number, topic)
  values (v_entry_id, v_scheme_id, 1, 1, 'RLS Test Topic');

  -- ---- 1. Tenant isolation (SELECT): School B's teacher, despite having
  --         every scheme_of_work permission a teacher normally has, cannot
  --         see School A's scheme at all. ----
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_teacher_b_auth, 'role', 'authenticated')::text, true);
  select count(*) into v_count from schemes_of_work where id = v_scheme_id;
  reset role;
  if v_count != 0 then
    raise exception 'FAIL tenant isolation (schemes_of_work select): % row(s) from another school visible', v_count;
  end if;

  -- ---- 2. Row ownership (UPDATE): Teacher A2 -- same school, has
  --         `write`, but is not this scheme's teacher_id and has no
  --         `write_any` -- cannot update it. ----
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_teacher_a2_auth, 'role', 'authenticated')::text, true);
  update schemes_of_work set total_weeks = 9 where id = v_scheme_id;
  get diagnostics v_count = row_count;
  reset role;
  if v_count != 0 then
    raise exception 'FAIL row ownership (schemes_of_work update): a non-owning teacher without write_any updated %s row(s)', v_count;
  end if;

  -- ---- 3. write_any override (UPDATE): Principal A -- same school, has
  --         `write_any`, is not this scheme's teacher_id -- CAN update it. ----
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_principal_a_auth, 'role', 'authenticated')::text, true);
  update schemes_of_work set total_weeks = 9 where id = v_scheme_id;
  get diagnostics v_count = row_count;
  reset role;
  if v_count != 1 then
    raise exception 'FAIL write_any override (schemes_of_work update): expected exactly 1 row updated by a write_any holder, got %', v_count;
  end if;

  -- ---- 4. INSERT-time ownership: Teacher A can create a scheme naming
  --         themselves as teacher_id; cannot name a colleague. ----
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_teacher_a_auth, 'role', 'authenticated')::text, true);

  v_new_scheme_id := gen_random_uuid();
  insert into schemes_of_work (id, school_id, academic_year_id, term_id, class_id, subject_id, teacher_id, total_weeks, lessons_per_week)
  values (v_new_scheme_id, v_school_a, v_ay_a, v_term_a, v_class_a, v_subject_a, v_teacher_a_su, 3, 2);

  v_insert_failed := false;
  begin
    insert into schemes_of_work (id, school_id, academic_year_id, term_id, class_id, subject_id, teacher_id, total_weeks, lessons_per_week)
    values (gen_random_uuid(), v_school_a, v_ay_a, v_term_a, v_class_a, v_subject_a, v_teacher_a2_su, 3, 2);
  exception when others then
    v_insert_failed := true;
  end;
  reset role;
  if not v_insert_failed then
    raise exception 'FAIL insert-time ownership: a teacher created a scheme naming a colleague as teacher_id';
  end if;

  -- ---- 5. scheme_of_work_entries inherits the same tenant boundary via
  --         its parent scheme (entries carry no school_id/teacher_id of
  --         their own -- this is the actual policy shape, not assumed). ----
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_teacher_b_auth, 'role', 'authenticated')::text, true);
  select count(*) into v_count from scheme_of_work_entries where id = v_entry_id;
  if v_count != 0 then
    reset role;
    raise exception 'FAIL tenant isolation (scheme_of_work_entries select): % row(s) from another school visible', v_count;
  end if;
  update scheme_of_work_entries set topic = 'hijacked' where id = v_entry_id;
  get diagnostics v_count = row_count;
  reset role;
  if v_count != 0 then
    raise exception 'FAIL tenant isolation (scheme_of_work_entries update): % row(s) updated from another school', v_count;
  end if;

  raise notice 'scheme_of_work RLS behavioral checks: all passed';
end $$;

rollback;

-- Independent tripwire, in its own implicit transaction after the explicit
-- rollback above: if this ever finds fixture rows, the rollback didn't
-- actually happen (or something committed early), which is a bug in this
-- test file, not in the RLS policies -- treat it as such.
do $$
begin
  if exists (select 1 from schools where slug in ('rls-test-school-a', 'rls-test-school-b')) then
    raise exception 'LEAK DETECTED: rls-test fixture rows were not rolled back -- this test file has a bug, fix before trusting its results again';
  end if;
end $$;
