-- Used by .github/workflows/rls-coverage-check.yml. Emits one JSON array: every table in `public`
-- that has a school_id column, with whether RLS is on and whether its policies are tenant-scoped.
--
-- A table's policies count as tenant-scoped (references_tenant_helper = true) when ANY policy:
--   1. names auth_school_id() or auth_is_super_admin() directly, OR
--   2. calls a public helper function that COMPARES ONE OF ITS OWN ARGUMENTS to auth_school_id()
--      (e.g. staff_loans_can_read(p_school, ...) = `p_school = auth_school_id() and ...`), OR
--   3. delegates to a parent table that is itself covered by (1) or (2), via
--      `exists (select 1 from <parent> ...)`: the parent's RLS applies inside that subquery.
--
-- Rule 2 deliberately requires the argument comparison. A helper that merely mentions
-- auth_school_id() without comparing a row's school to it (a feature-flag check such as
-- my_school_has_feature_flag(text), say) does NOT qualify, because `using (flag_helper('x'))`
-- would show every school's rows to any user whose own school has the flag.
-- Resolution is one level deep and heuristic, like the textual check it extends; anything it
-- cannot resolve is still reported and needs a reviewed entry in supabase/.rls_coverage_allowlist.
with tenant_helpers as (
  select p.proname,
         replace(lower(p.prosrc), ' ', '') as src,
         p.proargnames
  from pg_proc p
  join pg_namespace pn on pn.oid = p.pronamespace
  where pn.nspname = 'public'
    and p.proargnames is not null
),
arg_compare_helpers as (
  select distinct h.proname
  from tenant_helpers h, unnest(h.proargnames) as arg
  where arg is not null and arg <> ''
    and (   h.src like '%' || lower(arg) || '=auth_school_id()%'
         or h.src like '%' || lower(arg) || '=public.auth_school_id()%'
         or h.src like '%auth_school_id()=' || lower(arg) || '%'
         or h.src like '%public.auth_school_id()=' || lower(arg) || '%')
),
pol as (
  select tablename, policyname, coalesce(qual, '') as qual, coalesce(with_check, '') as wc
  from pg_policies where schemaname = 'public'
),
first_pass as (
  select tablename,
         count(*) as policy_count,
         bool_or(
              qual ilike '%auth_school_id%' or wc ilike '%auth_school_id%'
           or qual ilike '%auth_is_super_admin%' or wc ilike '%auth_is_super_admin%'
           or exists (select 1 from arg_compare_helpers f
                      where (qual ilike '%' || f.proname || '(%' or wc ilike '%' || f.proname || '(%')
                        and (qual ilike '%school_id%' or wc ilike '%school_id%'))
         ) as has_tenant_ref
  from pol group by tablename
),
covered as (select tablename from first_pass where has_tenant_ref),
second_pass as (
  select pol.tablename,
         bool_or(exists (select 1 from covered c
                         where lower(pol.qual) like '%from ' || lower(c.tablename) || ' %'
                            or lower(pol.qual) like '%from public.' || lower(c.tablename) || ' %')) as via_parent
  from pol group by pol.tablename
)
select coalesce(json_agg(row_to_json(x)), '[]') from (
  select
    t.table_name as table,
    c.relrowsecurity as rls_enabled,
    coalesce(fp.policy_count, 0) as policy_count,
    (coalesce(fp.has_tenant_ref, false) or coalesce(sp.via_parent, false)) as references_tenant_helper
  from information_schema.tables t
  join pg_class c on c.relname = t.table_name
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = t.table_schema
  left join first_pass fp on fp.tablename = t.table_name
  left join second_pass sp on sp.tablename = t.table_name
  where t.table_schema = 'public'
    and t.table_type = 'BASE TABLE'
    and exists (
      select 1 from information_schema.columns col
      where col.table_schema = 'public'
        and col.table_name = t.table_name
        and col.column_name = 'school_id'
    )
) x;
