-- The wizard UI implementation these supported was discarded in favor of the
-- already-pushed, independently-built Phase 12 (commit 61ce06c) which took a
-- different, lighter design approach (no dedicated admissions_officer role,
-- no new admission-number generator, plain client queries instead of RPCs for
-- duplicate detection and student creation). These objects are unused by any
-- code now on main. Dropping them so the live schema matches the repo exactly
-- -- per this project's own standing rule against schema drift.

drop view if exists public.v_bed_availability;
drop function if exists public.allocate_bed(uuid, uuid);
drop function if exists public.advance_wizard_student_enrollment(uuid);
drop function if exists public.create_student_from_application(uuid);
drop index if exists public.idx_applications_resulting_student;
drop function if exists public.find_possible_duplicate_students(text, text, date, text);
drop view if exists public.v_stream_capacity;
drop function if exists public.generate_admission_number(uuid);
drop sequence if exists public.admission_number_seq;

delete from public.role_permissions where role_id = (select id from public.roles where name = 'admissions_officer');
delete from public.roles where name = 'admissions_officer';
