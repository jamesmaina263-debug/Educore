-- Permanent deletion of a whole school (tenant), for the platform admin console.
--
-- Why this needs a purpose-built function: `delete from schools` cannot work here. Most of the ~175
-- tables that hang off a school reference it with NO ACTION / RESTRICT (not CASCADE), a few delete-time
-- triggers actively block it (closed-exam structure lock, invoice guards), and ~40 audit triggers would
-- write a fresh audit_log row -- carrying the full old row, i.e. the student/medical data we are trying to
-- erase -- for every row deleted. So this adds ONE narrow, audited, all-or-nothing path.
--
-- How it works (all in a single transaction -- any failure rolls back and nothing is deleted):
--   1. Super admin only, a reason, the school's slug typed back exactly, and the school must already be
--      suspended or cancelled (so a live/trial school is never one click from deletion).
--   2. The set of tables the school owns is discovered from the catalog (foreign keys), not hard-coded, so
--      it keeps working as tables are added. Ownership is deliberately conservative -- see "Ownership" below.
--   3. Rows are removed referencing-tables-first, scoped to this school only; other schools are untouched.
--   4. Anything that would be unsafe or unrecognised ABORTS the purge instead of guessing.
--   5. Returns a snapshot (counts, orphaned login accounts) and writes it to platform_admin_activity_log in
--      the same transaction, so the record of the deletion can never be lost independently of the deletion.
--
-- Ownership (fail-closed):
--   * A table is owned if it has a direct FK to schools, or is a CASCADE child of an owned table, or is one of
--     two reviewed plain-NO-ACTION children (api_request_logs, kicd_strands).
--   * A table that `schools` itself references (school_groups) is a shared parent and is NEVER deleted.
--     A shared table that merely points at this school's rows (school_groups.verified_by -> school_users) is
--     detached (column set to NULL) rather than deleted. Anything else pointing in is a hard error.
--
-- What this does NOT do (the server action does these afterwards, because SQL cannot):
--   * delete the school's files from Supabase Storage;
--   * delete the school's login accounts from auth.users (this function returns the ids that are safe to
--     remove: no other row anywhere still references them).
--
-- Nothing here changes any existing school's data. The two edits to existing objects are additive no-ops
-- unless the transaction-local flag `educore.school_purge` is on, which only the function below sets.

-- ============================================================
-- 1. Hooks: let the purge (and only the purge) bypass delete-time guards
-- ============================================================

-- 1a. audit_log: skip row inserts during a purge. Without this every deleted student/staff/fee row would
--     re-appear in audit_log as an 'delete' entry holding its entire old value.
create or replace function public.audit_log_skip_during_purge()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if coalesce(current_setting('educore.school_purge', true), '') = 'on' then
    return null;
  end if;
  return new;
end;
$$;

revoke all on function public.audit_log_skip_during_purge() from public, anon, authenticated;

drop trigger if exists trg_00_audit_log_skip_during_purge on public.audit_log;
create trigger trg_00_audit_log_skip_during_purge
  before insert on public.audit_log
  for each row execute function public.audit_log_skip_during_purge();

-- 1b. Closed-exam structure lock: identical to the current definition, plus "allow DELETE during a purge".
create or replace function public.enforce_exam_structure_lock()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_exam_id uuid := coalesce(new.exam_id, old.exam_id);
  v_status text;
begin
  if tg_op = 'DELETE' and coalesce(current_setting('educore.school_purge', true), '') = 'on' then
    return old;
  end if;
  select status into v_status from exams where id = v_exam_id;
  if v_status = 'closed' then
    raise exception 'Cannot modify exam structure after the exam is closed.';
  end if;
  return coalesce(new, old);
end;
$$;

-- (platform_invoices_guard / platform_invoice_events_append_only already allow DELETE while the
--  transaction-local flag educore.invoice_hard_delete is on; the purge sets that flag too, so they need no change.)

-- ============================================================
-- 2. Read-only preview for the confirmation dialog
-- ============================================================
create or replace function public.school_deletion_preview(p_school_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_school public.schools%rowtype;
  v_students bigint;
  v_staff bigint;
  v_accounts bigint;
  v_invoices bigint;
  v_paid_n bigint;
  v_paid_kes numeric;
  v_super boolean;
  v_blockers text[] := '{}';
begin
  if not auth_is_super_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  select * into v_school from public.schools where id = p_school_id;
  if v_school.id is null then raise exception 'School not found.'; end if;

  select count(*) into v_students from public.students where school_id = p_school_id;
  select count(*) into v_staff
    from public.school_users su join public.roles r on r.id = su.role_id
    where su.school_id = p_school_id and r.name not in ('parent', 'student', 'super_admin');
  select count(*) into v_accounts from public.school_users where school_id = p_school_id and auth_user_id is not null;
  select count(*) into v_invoices from public.platform_invoices where school_id = p_school_id;
  select count(*) filter (where voided_at is null), coalesce(sum(amount_kes) filter (where voided_at is null), 0)
    into v_paid_n, v_paid_kes
    from public.platform_invoice_payments where school_id = p_school_id;
  select exists (select 1 from public.school_users su join public.roles r on r.id = su.role_id
                 where su.school_id = p_school_id and r.name = 'super_admin') into v_super;

  if v_school.status not in ('suspended', 'cancelled') then
    v_blockers := array_append(v_blockers, 'The school must be suspended or cancelled first.'::text);
  end if;
  if v_super then
    v_blockers := array_append(v_blockers, 'A platform super-admin account is attached to this school.'::text);
  end if;

  return jsonb_build_object(
    'school_id', v_school.id,
    'name', v_school.name,
    'slug', v_school.slug,
    'status', v_school.status,
    'students', v_students,
    'staff', v_staff,
    'login_accounts', v_accounts,
    'platform_invoices', v_invoices,
    'paid_payments', v_paid_n,
    'paid_kes', v_paid_kes,
    'blockers', to_jsonb(v_blockers),
    'can_delete', cardinality(v_blockers) = 0
  );
end;
$$;

revoke all on function public.school_deletion_preview(uuid) from public, anon;
grant execute on function public.school_deletion_preview(uuid) to authenticated;

comment on function public.school_deletion_preview(uuid) is
  'Platform super admin only. Read-only headline counts shown in the permanent-delete confirmation dialog.';

-- ============================================================
-- 3. The one sanctioned way to delete a school
-- ============================================================
create or replace function public.delete_school_permanently(
  p_school_id uuid,
  p_confirm_slug text,
  p_reason text,
  p_erase_paid_billing boolean default false,
  p_operator text default null
)
returns jsonb
language plpgsql
security definer
-- pg_temp last, and every relation below is schema-qualified, so a caller-created temp table can never shadow
-- a real one inside this SECURITY DEFINER function. The longer timeout is honoured by PostgREST (it applies the
-- function's own settings before the call); the default 8s API timeout is far too short for a large school.
set search_path to 'public', 'pg_temp'
set statement_timeout to '10min'
as $$
declare
  c_schools constant oid := 'public.schools'::regclass::oid;
  -- Reviewed owned tables whose only link into the school is a plain NO ACTION FK to an owned parent.
  c_allowlist constant text[] := array['api_request_logs', 'kicd_strands'];

  v_school public.schools%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_operator text := coalesce(nullif(btrim(p_operator), ''), 'unidentified');

  v_paid_n bigint := 0;
  v_paid_kes numeric := 0;
  v_invoices bigint := 0;
  v_students bigint := 0;
  v_staff bigint := 0;

  v_auth_ids uuid[] := '{}';
  v_orphans uuid[] := '{}';
  v_ref uuid[];
  v_vault_ids uuid[] := '{}';
  v_vault_deleted bigint := 0;

  v_counts jsonb := '{}'::jsonb;
  v_detached jsonb := '{}'::jsonb;
  v_total bigint := 0;
  v_n bigint;
  v_snapshot jsonb;

  t record;
  e record;
  v_pred text;
  v_scope_cols text;
  v_has_direct boolean;
  v_has_cascade boolean;
  v_cols text[];
  v_self text;
  v_guard integer;
  v_total_step bigint;
begin
  -- ---------- authorisation and guards ----------
  -- Platform super admin only. Deliberately NOT open to service_role: this is a human decision.
  if not auth_is_super_admin() then
    raise exception 'Not authorized to permanently delete a school.' using errcode = '42501';
  end if;
  if char_length(v_reason) < 3 or char_length(v_reason) > 300 then
    raise exception 'Give a short reason (3-300 characters) for deleting this school.';
  end if;

  select * into v_school from public.schools where id = p_school_id for update;
  if v_school.id is null then
    raise exception 'School not found.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('school_purge:' || p_school_id::text, 0));

  if p_confirm_slug is null or btrim(p_confirm_slug) <> v_school.slug then
    raise exception 'The school slug you typed does not match "%". Nothing was deleted.', v_school.slug;
  end if;

  if v_school.status not in ('suspended', 'cancelled') then
    raise exception 'Only a suspended or cancelled school can be deleted permanently. "%" is currently %. Suspend it first.',
      v_school.name, v_school.status;
  end if;

  -- Deleting the school would delete this person's own school_users row, i.e. their platform access.
  if exists (
    select 1 from public.school_users su join public.roles r on r.id = su.role_id
    where su.school_id = p_school_id and r.name = 'super_admin'
  ) then
    raise exception 'A platform super-admin account is attached to this school, so deleting it would remove platform access. Nothing was deleted.';
  end if;

  select count(*) filter (where voided_at is null), coalesce(sum(amount_kes) filter (where voided_at is null), 0)
    into v_paid_n, v_paid_kes
    from public.platform_invoice_payments where school_id = p_school_id;
  select count(*) into v_invoices from public.platform_invoices where school_id = p_school_id;
  if v_paid_n > 0 and not coalesce(p_erase_paid_billing, false) then
    raise exception 'This school has % recorded subscription payment(s) totalling KES %. Confirm that you also want those billing records erased. Nothing was deleted.',
      v_paid_n, to_char(v_paid_kes, 'FM999,999,999,990.00');
  end if;

  select count(*) into v_students from public.students where school_id = p_school_id;
  select count(*) into v_staff
    from public.school_users su join public.roles r on r.id = su.role_id
    where su.school_id = p_school_id and r.name not in ('parent', 'student', 'super_admin');

  -- Captured BEFORE deleting; used after.
  select coalesce(array_agg(auth_user_id), '{}') into v_auth_ids
    from public.school_users where school_id = p_school_id and auth_user_id is not null;
  select coalesce(array_agg(x), '{}') into v_vault_ids
    from public.mpesa_credentials mc,
         lateral unnest(array[mc.consumer_key_id, mc.consumer_secret_id, mc.passkey_id]) x
    where mc.school_id = p_school_id and x is not null;

  -- ---------- discover the FK graph ----------
  drop table if exists pg_temp._sp_fk;
  drop table if exists pg_temp._sp_owned;
  drop table if exists pg_temp._sp_edge;
  create temp table _sp_fk (
    conoid oid, child oid, parent oid, ctype "char", child_cols text[], parent_cols text[], ncols int
  ) on commit drop;
  create temp table _sp_owned (oid oid primary key, depth int not null default 0, pred text, qname text) on commit drop;
  create temp table _sp_edge (child oid, conoid oid) on commit drop;

  insert into _sp_fk
  select c.oid, c.conrelid, c.confrelid, c.confdeltype,
         array(select a.attname::text from unnest(c.conkey) with ordinality k(n, o)
               join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n order by k.o),
         array(select a.attname::text from unnest(c.confkey) with ordinality k(n, o)
               join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.n order by k.o),
         cardinality(c.conkey)
  from pg_constraint c
  join pg_class pc on pc.oid = c.confrelid and pc.relnamespace = 'public'::regnamespace
  where c.contype = 'f' and c.conparentid = 0 and c.conrelid <> c.confrelid;

  -- Owned set: walk down from schools along NO ACTION / RESTRICT / CASCADE edges, never into a table that
  -- `schools` itself references (a shared parent such as school_groups).
  with recursive r(oid, depth) as (
    select c_schools, 0
    union
    select f.child, r.depth + 1
    from _sp_fk f join r on f.parent = r.oid
    where f.ctype in ('a', 'r', 'c')
      and f.child not in (select parent from _sp_fk where child = c_schools)
      and r.depth < 60
  )
  insert into _sp_owned (oid)
  select distinct r.oid from r;

  -- Delete order: depth = longest path from schools over EVERY edge type among owned tables (SET NULL edges
  -- included), so every referencing table sorts after what it references. Deleting deepest-first then
  -- means Postgres never has to run a per-row ON DELETE SET NULL update.
  with recursive r(oid, depth) as (
    select c_schools, 0
    union
    select f.child, r.depth + 1
    from _sp_fk f join r on f.parent = r.oid
    where f.child in (select oid from _sp_owned) and f.parent in (select oid from _sp_owned) and r.depth < 60
  ), d as (select oid, max(depth) m from r group by oid)
  update _sp_owned o set depth = d.m from d where d.oid = o.oid;

  if exists (select 1 from _sp_owned where depth >= 60) then
    raise exception 'Foreign-key cycle detected among school-owned tables; delete_school_permanently needs updating. Nothing was deleted.';
  end if;

  update _sp_owned o
     set qname = format('%I.%I', n.nspname, c.relname)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.oid = o.oid;

  -- ---------- fail-closed checks ----------
  -- (a) Anything outside the owned set that points INTO it must be safely detachable.
  for e in
    select f.*, cl.relname as child_name, pcl.relname as parent_name
    from _sp_fk f
    join pg_class cl on cl.oid = f.child
    join pg_class pcl on pcl.oid = f.parent
    where f.parent in (select oid from _sp_owned)
      and f.child not in (select oid from _sp_owned)
      and f.ctype in ('a', 'r', 'c')
  loop
    if e.ctype = 'c' or e.ncols <> 1
       or (select a.attnotnull from pg_attribute a join pg_constraint k on k.oid = e.conoid
           where a.attrelid = k.conrelid and a.attnum = k.conkey[1]) then
      raise exception 'Unsupported dependency: %.% references this school''s data (%) and cannot be detached automatically. Nothing was deleted.',
        e.child_name, e.child_cols[1], e.parent_name;
    end if;
  end loop;

  -- (b) Every owned table must be owned for a recognised reason; pick the edges that define "its rows".
  for t in
    select o.oid, o.depth, o.qname, c.relname
    from _sp_owned o join pg_class c on c.oid = o.oid
    where o.oid <> c_schools
    order by o.depth, c.relname
  loop
    v_has_direct := exists (
      select 1 from _sp_fk f where f.child = t.oid and f.parent = c_schools and f.ctype in ('a', 'r', 'c'));
    v_has_cascade := exists (
      select 1 from _sp_fk f
      where f.child = t.oid and f.parent in (select oid from _sp_owned) and f.parent <> c_schools and f.ctype = 'c');

    if v_has_direct then
      insert into _sp_edge select t.oid, f.conoid from _sp_fk f
        where f.child = t.oid and f.parent = c_schools and f.ctype in ('a', 'r', 'c');
    elsif v_has_cascade then
      insert into _sp_edge select t.oid, f.conoid from _sp_fk f
        where f.child = t.oid and f.parent in (select oid from _sp_owned) and f.parent <> c_schools and f.ctype = 'c';
    elsif t.relname = any (c_allowlist) then
      insert into _sp_edge select t.oid, f.conoid from _sp_fk f
        where f.child = t.oid and f.parent in (select oid from _sp_owned) and f.parent <> c_schools and f.ctype in ('a', 'r');
    else
      raise exception 'Unrecognised table "%" depends on this school''s data but is not clearly owned by it; delete_school_permanently needs reviewing. Nothing was deleted.',
        t.relname;
    end if;
  end loop;

  -- ---------- build per-table scopes (materialised keys), parents first ----------
  -- Every row to be deleted is identified by "belongs to this school directly, or points at a parent row that
  -- does". Parent key sets are materialised up front so the predicates stay valid as rows disappear.
  for t in
    select o.oid, o.depth, o.qname
    from _sp_owned o join pg_class c on c.oid = o.oid
    where o.oid <> c_schools
    order by o.depth, c.relname
  loop
    select string_agg(
             case when f.parent = c_schools
                  then format('tgt.%I = %L', f.child_cols[1], p_school_id)
                  else format('exists (select 1 from pg_temp.%I x where %s)',
                              '_sp_s' || f.parent::text,
                              (select string_agg(format('x.%I = tgt.%I', f.parent_cols[i], f.child_cols[i]), ' and ')
                               from generate_series(1, f.ncols) i))
             end,
             ' or ')
      into v_pred
    from _sp_edge ed join _sp_fk f on f.conoid = ed.conoid
    where ed.child = t.oid;

    update _sp_owned set pred = v_pred where oid = t.oid;

    -- Materialise the key columns that other tables' predicates (or the detach step) read from this table.
    select array_agg(distinct pc) into v_cols
    from (
      select unnest(f.parent_cols) pc
      from _sp_fk f
      where f.parent = t.oid
        and ( f.conoid in (select conoid from _sp_edge)
              or (f.child not in (select oid from _sp_owned) and f.ctype in ('a', 'r')) )
    ) s;

    if v_cols is not null then
      select string_agg(format('%I', c), ', ') into v_scope_cols from unnest(v_cols) c;
      execute format('create temp table pg_temp.%I on commit drop as select distinct %s from %s as tgt where %s',
                     '_sp_s' || t.oid::text, v_scope_cols, t.qname, v_pred);
    end if;
  end loop;

  -- ---------- point of no return (still transactional) ----------
  perform set_config('educore.school_purge', 'on', true);
  perform set_config('educore.invoice_hard_delete', 'on', true);

  -- Detach shared records that merely point at this school's rows (e.g. school_groups.verified_by).
  for e in
    select f.*, n.nspname, cl.relname
    from _sp_fk f
    join pg_class cl on cl.oid = f.child
    join pg_namespace n on n.oid = cl.relnamespace
    where f.parent in (select oid from _sp_owned)
      and f.child not in (select oid from _sp_owned)
      and f.ctype in ('a', 'r')
  loop
    execute format('update %I.%I tgt set %I = null where exists (select 1 from pg_temp.%I x where x.%I = tgt.%I)',
                   e.nspname, e.relname, e.child_cols[1], '_sp_s' || e.parent::text, e.parent_cols[1], e.child_cols[1]);
    get diagnostics v_n = row_count;
    if v_n > 0 then
      v_detached := v_detached || jsonb_build_object(e.relname || '.' || e.child_cols[1], v_n);
    end if;
  end loop;

  -- Delete everything the school owns, deepest (most-referencing) tables first.
  for t in
    select o.oid, o.qname, o.pred, c.relname
    from _sp_owned o join pg_class c on c.oid = o.oid
    where o.oid <> c_schools
    order by o.depth desc, c.relname
  loop
    v_n := 0;

    -- A table that references ITSELF (e.g. platform_invoices.replaces_invoice_id, enforced RESTRICT row by row)
    -- cannot be cleared in one statement. Remove rows nothing else in the table still points at, repeatedly,
    -- leaf first. Bounded; anything still referenced from outside the school's rows then fails the sweep below.
    select string_agg(
             format('exists (select 1 from %s y where %s and y.ctid <> tgt.ctid)', t.qname,
                    (select string_agg(format('y.%I = tgt.%I', ca.attname, pa.attname), ' and ')
                     from unnest(k.conkey, k.confkey) u(cn, pn)
                     join pg_attribute ca on ca.attrelid = k.conrelid and ca.attnum = u.cn
                     join pg_attribute pa on pa.attrelid = k.confrelid and pa.attnum = u.pn)),
             ' or ')
      into v_self
    from pg_constraint k
    where k.conrelid = t.oid and k.confrelid = t.oid and k.contype = 'f'
      and k.conparentid = 0 and k.confdeltype in ('a', 'r');

    if v_self is not null then
      v_guard := 0;
      loop
        execute format('delete from %s as tgt where (%s) and not (%s)', t.qname, t.pred, v_self);
        get diagnostics v_total_step = row_count;
        v_n := v_n + v_total_step;
        v_guard := v_guard + 1;
        exit when v_total_step = 0 or v_guard >= 1000;
      end loop;
    end if;

    execute format('delete from %s as tgt where %s', t.qname, t.pred);
    get diagnostics v_total_step = row_count;
    v_n := v_n + v_total_step;
    if v_n > 0 then
      v_counts := v_counts || jsonb_build_object(t.relname, v_n);
      v_total := v_total + v_n;
    end if;
  end loop;

  delete from public.schools where id = p_school_id;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'The school row could not be deleted. Nothing was deleted.';
  end if;

  perform set_config('educore.school_purge', 'off', true);
  perform set_config('educore.invoice_hard_delete', 'off', true);

  -- M-Pesa credentials live in Vault; the row is gone, so remove the secrets themselves.
  if cardinality(v_vault_ids) > 0 then
    delete from vault.secrets where id = any (v_vault_ids);
    get diagnostics v_vault_deleted = row_count;
  end if;

  -- Login accounts that nothing else references any more. A login still referenced anywhere (another
  -- school_users row, a platform notification read marker, ...) is left alone.
  v_orphans := v_auth_ids;
  for e in
    select c.conrelid::regclass::text as tbl, a.attname::text as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = 'auth.users'::regclass
      and c.conparentid = 0 and cardinality(c.conkey) = 1 and c.confdeltype in ('a', 'r', 'c')
  loop
    execute format('select coalesce(array_agg(distinct %I), ''{}'') from %s where %I = any($1)', e.col, e.tbl, e.col)
      into v_ref using v_orphans;
    v_orphans := array(select unnest(v_orphans) except select unnest(v_ref));
  end loop;

  v_snapshot := jsonb_build_object(
    'school_id', v_school.id,
    'school_name', v_school.name,
    'slug', v_school.slug,
    'status_at_deletion', v_school.status,
    'reason', v_reason,
    'students_deleted', v_students,
    'staff_deleted', v_staff,
    'platform_invoices_deleted', v_invoices,
    'paid_payments_erased', v_paid_n,
    'paid_kes_erased', v_paid_kes,
    'rows_deleted_total', v_total,
    'rows_deleted_by_table', v_counts,
    'references_detached', v_detached,
    'vault_secrets_deleted', v_vault_deleted,
    'login_accounts_linked', cardinality(v_auth_ids),
    'login_accounts_to_remove', cardinality(v_orphans)
  );

  -- Same transaction as the deletion: the record of what was erased cannot be lost independently of it.
  insert into public.platform_admin_activity_log (actor_user_id, actor_email, action, detail)
  values (auth.uid(), auth.email(), 'delete_school_permanently', v_snapshot || jsonb_build_object('operator', v_operator));

  return v_snapshot || jsonb_build_object('auth_user_ids_to_remove', to_jsonb(v_orphans));
end;
$$;

revoke all on function public.delete_school_permanently(uuid, text, text, boolean, text) from public, anon;
grant execute on function public.delete_school_permanently(uuid, text, text, boolean, text) to authenticated;

comment on function public.delete_school_permanently(uuid, text, text, boolean, text) is
  'Platform super admin only. Irreversibly deletes a suspended/cancelled school and everything it owns, in one transaction, after its slug is typed back and a reason given. Files and login accounts are removed by the caller afterwards. Returns a snapshot (also written to platform_admin_activity_log).';
