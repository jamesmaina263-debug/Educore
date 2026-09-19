-- Part 16 of the RLS consolidation series. schools had 2 SELECT-only
-- permissive policies. Literal OR, copied verbatim.
drop policy schools_select on public.schools;
drop policy schools_select_group_admin on public.schools;
create policy schools_select on public.schools
  for select
  using (
    (auth_is_super_admin() or id = auth_school_id())
    or (
      school_group_id = auth_group_id()
      and (auth_has_permission('group.branding.write') or auth_has_permission('group.reports.read'))
    )
  );
