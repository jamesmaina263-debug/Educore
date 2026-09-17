-- Part 21. remark_bank_entries had 2 ALL-cmd permissive policies
-- (school_write + super_admin_write); merged. Select policy untouched,
-- same reasoning as above.
drop policy remark_bank_entries_school_write on public.remark_bank_entries;
drop policy remark_bank_entries_super_admin_write on public.remark_bank_entries;
create policy remark_bank_entries_write on public.remark_bank_entries
  for all
  using (
    (school_id = auth_school_id() and auth_has_permission('academics.write'))
    or (school_id is null and auth_is_super_admin())
  )
  with check (
    (school_id = auth_school_id() and auth_has_permission('academics.write'))
    or (school_id is null and auth_is_super_admin())
  );
