-- school_groups previously had a Phase-0 policy letting ANY staff at any member school
-- read the entire row -- including custom_domain, custom_domain_status, verified_at,
-- verified_by, which no regular staff member has any functional need to see. The newer
-- Phase-5 group_admin policy was fully redundant with it (a group_admin already qualifies
-- as "staff at a school in that group"), so it was never actually adding a restriction.
--
-- Split: base table now requires group.branding.write or group.reports.read (what
-- group_admin holds by default, and what /campuses + /admin/whitelabel already need).
-- A new SECURITY DEFINER function covers the safe branding fields (name/logo/color/
-- whitelabel flag) that general settings already relies on for ANY staff member visiting
-- that page -- same "narrow RLS + widen via a scoped RPC" pattern as group_schools_summary.

drop policy if exists school_groups_select on public.school_groups;
drop policy if exists school_groups_select_group_admin on public.school_groups;

create policy school_groups_select_privileged on public.school_groups
  for select
  using (
    auth_is_super_admin()
    or (
      id = auth_group_id()
      and (auth_has_permission('group.branding.write') or auth_has_permission('group.reports.read'))
    )
  );

create or replace function public.group_branding_public(p_group_id uuid)
returns table (id uuid, name text, logo_url text, primary_color text, whitelabel_enabled boolean)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select sg.id, sg.name, sg.logo_url, sg.primary_color, sg.whitelabel_enabled
  from school_groups sg
  where sg.id = p_group_id
    and exists (
      select 1 from schools s
      where s.id = auth_school_id() and s.school_group_id = p_group_id
    );
$function$;

revoke all on function public.group_branding_public(uuid) from public, anon;
grant execute on function public.group_branding_public(uuid) to authenticated;
