-- KICD content: let school management (school_owner / principal / deputy_principal,
-- i.e. academics.write) do everything the platform admin can -- import, review/edit,
-- publish, withdraw, discard -- for THEIR OWN school's content.
--
-- Scoping: kicd_content_sources.school_id
--   NULL      = platform-wide content, managed by platform admins only, visible to
--               every school while published (unchanged behaviour).
--   NOT NULL  = private to that school: only that school sees it (published), only
--               that school's academics.write holders can manage it, and it never
--               affects any other school. Platform admins can still see/withdraw it.
-- No school role can create, edit, publish, withdraw or delete another school's
-- content or any platform-wide content.

alter table kicd_content_sources
  add column school_id uuid references schools(id) on delete cascade;
create index idx_kicd_content_sources_school on kicd_content_sources(school_id) where school_id is not null;
comment on column kicd_content_sources.school_id is 'NULL = platform-wide shared content (platform admins only). Set = private to that school, managed by its academics.write holders.';

-- True when the caller may create/edit/delete content belonging to a source with this school_id.
create or replace function kicd_can_manage_source(p_school_id uuid)
returns boolean
language sql
stable
as $$
  select auth_is_super_admin()
    or (p_school_id is not null and p_school_id = auth_school_id() and auth_has_permission('academics.write'));
$$;
revoke execute on function kicd_can_manage_source(uuid) from anon, public;
grant execute on function kicd_can_manage_source(uuid) to authenticated;

-- ---- kicd_content_sources
drop policy kicd_content_sources_select on kicd_content_sources;
drop policy kicd_content_sources_write on kicd_content_sources;
create policy kicd_content_sources_select on kicd_content_sources
  for select to authenticated using (
    auth_is_super_admin()
    or (is_enabled and (school_id is null or school_id = auth_school_id()))
    or (school_id = auth_school_id() and auth_has_permission('academics.write'))
  );
create policy kicd_content_sources_insert on kicd_content_sources
  for insert to authenticated with check (kicd_can_manage_source(school_id));
create policy kicd_content_sources_update on kicd_content_sources
  for update to authenticated using (kicd_can_manage_source(school_id)) with check (kicd_can_manage_source(school_id));
create policy kicd_content_sources_delete on kicd_content_sources
  for delete to authenticated using (kicd_can_manage_source(school_id));

-- ---- kicd_learning_areas (global taxonomy: names only)
-- School managers may ADD a missing learning area name (needed to import); only platform
-- admins may rename or delete them.
drop policy kicd_learning_areas_write on kicd_learning_areas;
create policy kicd_learning_areas_insert on kicd_learning_areas
  for insert to authenticated with check (
    auth_is_super_admin() or (auth_school_id() is not null and auth_has_permission('academics.write'))
  );
create policy kicd_learning_areas_update on kicd_learning_areas
  for update to authenticated using (auth_is_super_admin()) with check (auth_is_super_admin());
create policy kicd_learning_areas_delete on kicd_learning_areas
  for delete to authenticated using (auth_is_super_admin());

-- ---- kicd_strands (visibility and management both follow the parent source)
drop policy kicd_strands_select on kicd_strands;
drop policy kicd_strands_write on kicd_strands;
create policy kicd_strands_select on kicd_strands
  for select to authenticated using (
    exists (select 1 from kicd_content_sources s where s.id = kicd_strands.source_id)
  );
create policy kicd_strands_insert on kicd_strands
  for insert to authenticated with check (
    exists (select 1 from kicd_content_sources s where s.id = kicd_strands.source_id and kicd_can_manage_source(s.school_id))
  );
create policy kicd_strands_update on kicd_strands
  for update to authenticated
  using (exists (select 1 from kicd_content_sources s where s.id = kicd_strands.source_id and kicd_can_manage_source(s.school_id)))
  with check (exists (select 1 from kicd_content_sources s where s.id = kicd_strands.source_id and kicd_can_manage_source(s.school_id)));
create policy kicd_strands_delete on kicd_strands
  for delete to authenticated using (
    exists (select 1 from kicd_content_sources s where s.id = kicd_strands.source_id and kicd_can_manage_source(s.school_id))
  );

-- ---- kicd_sub_strands (select policy unchanged: it already follows kicd_strands)
drop policy kicd_sub_strands_write on kicd_sub_strands;
create policy kicd_sub_strands_insert on kicd_sub_strands
  for insert to authenticated with check (
    exists (select 1 from kicd_strands k join kicd_content_sources s on s.id = k.source_id
            where k.id = kicd_sub_strands.strand_id and kicd_can_manage_source(s.school_id))
  );
create policy kicd_sub_strands_update on kicd_sub_strands
  for update to authenticated
  using (exists (select 1 from kicd_strands k join kicd_content_sources s on s.id = k.source_id
                 where k.id = kicd_sub_strands.strand_id and kicd_can_manage_source(s.school_id)))
  with check (exists (select 1 from kicd_strands k join kicd_content_sources s on s.id = k.source_id
                      where k.id = kicd_sub_strands.strand_id and kicd_can_manage_source(s.school_id)));
create policy kicd_sub_strands_delete on kicd_sub_strands
  for delete to authenticated using (
    exists (select 1 from kicd_strands k join kicd_content_sources s on s.id = k.source_id
            where k.id = kicd_sub_strands.strand_id and kicd_can_manage_source(s.school_id))
  );
