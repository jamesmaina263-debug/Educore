-- Staff members without library.read_any could never see their own book
-- loans (e.g. a teacher who personally borrowed a book) -- the catalogue
-- page's own subtitle promises "Your borrowed items" for exactly this case,
-- but library_loans_select only had a self-access clause for students
-- (via school_users -> students.school_user_id), not for staff borrowers
-- (library_loans.staff_id). No live loans had hit this yet, but it's a
-- confirmed RLS gap against the app's own stated behavior.

drop policy if exists library_loans_select on public.library_loans;

create policy library_loans_select on public.library_loans
for select
using (
  auth_is_super_admin()
  or ((school_id = auth_school_id()) and auth_has_permission('library.read_any'))
  or auth_user_id_is_guardian_of(student_id)
  or (exists (
    select 1 from students st
    where st.id = library_loans.student_id
      and st.school_user_id = (
        select su.id from school_users su
        where su.auth_user_id = auth.uid() and su.status = 'active'
      )
  ))
  or (staff_id = auth_school_user_id())
);
