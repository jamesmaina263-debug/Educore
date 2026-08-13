-- Bug found immediately on live-testing issue_library_loan_to_staff(): library_loans.student_id
-- had a pre-existing NOT NULL constraint from before this phase, which conflicts with a
-- staff-only loan (student_id null, staff_id set). The one-borrower CHECK constraint added in
-- the previous migration is the real integrity guard; student_id itself needs to be nullable.
alter table public.library_loans alter column student_id drop not null;
