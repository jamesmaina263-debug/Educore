-- WP 6.2: Vote heads + ledger view (additive, dark behind feature.finance.vote_heads).
--
-- A vote head is an accounting bucket ("Tuition", "Boarding", "Repairs and maintenance"). This layer
-- only READS existing records: invoice_items (income, accrual: when a fee is invoiced) and approved
-- expenses (spending). It never changes how invoices, payments or expenses are stored, and it does not
-- read payments at all. Items are matched to a vote head by a per-school mapping on the normalised item
-- name / expense category. Anything unmapped lands in an explicit UNMAPPED bucket, and any part of an
-- invoice total that is not itemised lands in UNITEMISED, so the ledger always adds up to the invoiced
-- and approved-expense totals to the shilling.

-- 1. Flag catalog entry (visible to platform admins, enabled for nobody).
insert into public.platform_feature_flags (key, label, description)
select 'feature.finance.vote_heads',
       'Vote heads and ledger view',
       'Lets finance map fee items and expense categories to vote heads and see income and spending by vote head. Read-only over existing records. Off by default.'
where not exists (
  select 1 from public.platform_feature_flags where lower(key) = 'feature.finance.vote_heads'
);

-- 2. Vote heads.
create table if not exists public.vote_heads (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$'),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  kind text not null check (kind in ('income', 'expense')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (school_id, code),
  unique (id, school_id)
);
comment on table public.vote_heads is
  'Per-school accounting buckets. Never deleted: a vote head is switched off (is_active = false). Written only by create_vote_head() / set_vote_head_active().';
alter table public.vote_heads enable row level security;
drop policy if exists vote_heads_select on public.vote_heads;
create policy vote_heads_select on public.vote_heads for select
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('finance.read')));

-- 3. Mappings from an invoice item name / expense category to a vote head.
create table if not exists public.vote_head_mappings (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  source text not null check (source in ('invoice_item', 'expense_category')),
  match_key text not null check (match_key = lower(btrim(match_key)) and char_length(match_key) between 1 and 120),
  vote_head_id uuid not null,
  created_at timestamptz not null default now(),
  unique (school_id, source, match_key),
  foreign key (vote_head_id, school_id) references public.vote_heads (id, school_id) on delete restrict
);
comment on table public.vote_head_mappings is
  'match_key is lower(btrim(name)). invoice_item mappings must point at an income vote head, expense_category at an expense one (enforced by set_vote_head_mapping()).';
create index if not exists vote_head_mappings_head_idx on public.vote_head_mappings (vote_head_id);
alter table public.vote_head_mappings enable row level security;
drop policy if exists vote_head_mappings_select on public.vote_head_mappings;
create policy vote_head_mappings_select on public.vote_head_mappings for select
  using (auth_is_super_admin() or (school_id = auth_school_id() and auth_has_permission('finance.read')));

-- 4. Create a vote head.
create or replace function public.create_vote_head(p_code text, p_name text, p_kind text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := auth_school_id();
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_id uuid;
begin
  if v_school is null or not auth_has_permission('finance.write') then
    raise exception 'Not authorized to manage vote heads.' using errcode = '42501';
  end if;
  if not public.school_has_feature_flag(v_school, 'feature.finance.vote_heads') then
    raise exception 'Vote heads are not enabled for this school.' using errcode = '55000';
  end if;
  if v_code !~ '^[A-Z0-9][A-Z0-9_-]{0,19}$'
     or char_length(btrim(coalesce(p_name, ''))) not between 1 and 80
     or p_kind not in ('income', 'expense') then
    raise exception 'Invalid vote head.' using errcode = '22023';
  end if;
  if v_code in ('UNMAPPED', 'UNITEMISED') then
    raise exception 'That code is reserved.' using errcode = '22023';
  end if;
  insert into public.vote_heads (school_id, code, name, kind)
  values (v_school, v_code, btrim(p_name), p_kind)
  returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'A vote head with that code already exists.' using errcode = '23505';
end;
$$;
revoke all on function public.create_vote_head(text, text, text) from public, anon;
grant execute on function public.create_vote_head(text, text, text) to authenticated;

-- 5. Switch a vote head on or off (its mappings are kept; an inactive head still reports past activity).
create or replace function public.set_vote_head_active(p_vote_head_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := auth_school_id();
begin
  if v_school is null or not auth_has_permission('finance.write') then
    raise exception 'Not authorized to manage vote heads.' using errcode = '42501';
  end if;
  if not public.school_has_feature_flag(v_school, 'feature.finance.vote_heads') then
    raise exception 'Vote heads are not enabled for this school.' using errcode = '55000';
  end if;
  update public.vote_heads set is_active = coalesce(p_active, true)
   where id = p_vote_head_id and school_id = v_school;
  if not found then
    raise exception 'Vote head not found.' using errcode = '22023';
  end if;
end;
$$;
revoke all on function public.set_vote_head_active(uuid, boolean) from public, anon;
grant execute on function public.set_vote_head_active(uuid, boolean) to authenticated;

-- 6. Map (or re-map) an invoice item name / expense category to a vote head.
create or replace function public.set_vote_head_mapping(p_source text, p_name text, p_vote_head_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := auth_school_id();
  v_key text := lower(btrim(coalesce(p_name, '')));
  v_kind text;
  v_active boolean;
begin
  if v_school is null or not auth_has_permission('finance.write') then
    raise exception 'Not authorized to manage vote heads.' using errcode = '42501';
  end if;
  if not public.school_has_feature_flag(v_school, 'feature.finance.vote_heads') then
    raise exception 'Vote heads are not enabled for this school.' using errcode = '55000';
  end if;
  if p_source not in ('invoice_item', 'expense_category') or char_length(v_key) not between 1 and 120 then
    raise exception 'Invalid mapping.' using errcode = '22023';
  end if;
  select kind, is_active into v_kind, v_active
    from public.vote_heads where id = p_vote_head_id and school_id = v_school;
  if v_kind is null then
    raise exception 'Vote head not found.' using errcode = '22023';
  end if;
  if not v_active then
    raise exception 'That vote head is switched off.' using errcode = '22023';
  end if;
  if (p_source = 'invoice_item' and v_kind <> 'income') or (p_source = 'expense_category' and v_kind <> 'expense') then
    raise exception 'Fee items map to income vote heads and expense categories to expense vote heads.' using errcode = '22023';
  end if;
  insert into public.vote_head_mappings (school_id, source, match_key, vote_head_id)
  values (v_school, p_source, v_key, p_vote_head_id)
  on conflict (school_id, source, match_key) do update set vote_head_id = excluded.vote_head_id;
end;
$$;
revoke all on function public.set_vote_head_mapping(text, text, uuid) from public, anon;
grant execute on function public.set_vote_head_mapping(text, text, uuid) to authenticated;

-- 7. Remove a mapping (the items then fall back to UNMAPPED; nothing financial changes).
create or replace function public.remove_vote_head_mapping(p_source text, p_name text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := auth_school_id();
begin
  if v_school is null or not auth_has_permission('finance.write') then
    raise exception 'Not authorized to manage vote heads.' using errcode = '42501';
  end if;
  if not public.school_has_feature_flag(v_school, 'feature.finance.vote_heads') then
    raise exception 'Vote heads are not enabled for this school.' using errcode = '55000';
  end if;
  delete from public.vote_head_mappings
   where school_id = v_school and source = p_source and match_key = lower(btrim(coalesce(p_name, '')));
end;
$$;
revoke all on function public.remove_vote_head_mapping(text, text) from public, anon;
grant execute on function public.remove_vote_head_mapping(text, text) to authenticated;

-- 8. The ledger: income and spending per vote head.
--    Income  = invoice_items of the school's invoices (optionally one term), grouped by mapping.
--    Spending = APPROVED expenses (optionally dated within the term's start/end, by approval date).
--    Returns nothing when the flag is off or the caller lacks finance.read (fails closed).
create or replace function public.vote_head_ledger(p_term_id uuid default null)
returns table (vote_head_id uuid, code text, name text, kind text, lines bigint, amount numeric)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := auth_school_id();
  v_from date;
  v_to date;
begin
  if v_school is null or not auth_has_permission('finance.read')
     or not public.school_has_feature_flag(v_school, 'feature.finance.vote_heads') then
    return;
  end if;
  if p_term_id is not null then
    select start_date, end_date into v_from, v_to from public.terms where id = p_term_id and school_id = v_school;
    if not found then
      return;
    end if;
  end if;

  return query
  with inc as (
    select m.vote_head_id as vh, count(*) as n, sum(ii.amount) as amt
      from public.invoice_items ii
      join public.invoices i on i.id = ii.invoice_id
      left join public.vote_head_mappings m
        on m.school_id = i.school_id and m.source = 'invoice_item' and m.match_key = lower(btrim(ii.name))
     where i.school_id = v_school and (p_term_id is null or i.term_id = p_term_id)
     group by m.vote_head_id
  ), exp as (
    select m.vote_head_id as vh, count(*) as n, sum(e.amount) as amt
      from public.expenses e
      left join public.vote_head_mappings m
        on m.school_id = e.school_id and m.source = 'expense_category' and m.match_key = lower(btrim(e.category))
     where e.school_id = v_school and e.status = 'approved'
       and (p_term_id is null or (coalesce(e.approved_at, e.created_at)::date between v_from and v_to))
     group by m.vote_head_id
  ), itemised as (
    select coalesce(sum(ii.amount), 0) as amt
      from public.invoice_items ii join public.invoices i on i.id = ii.invoice_id
     where i.school_id = v_school and (p_term_id is null or i.term_id = p_term_id)
  ), invoiced as (
    select coalesce(sum(i.total_amount), 0) as amt
      from public.invoices i
     where i.school_id = v_school and (p_term_id is null or i.term_id = p_term_id)
  )
  -- Mapped heads (active ones always, inactive ones only when they carry activity).
  select h.id, h.code, h.name, h.kind,
         coalesce(case when h.kind = 'income' then inc.n else exp.n end, 0)::bigint,
         coalesce(case when h.kind = 'income' then inc.amt else exp.amt end, 0)::numeric
    from public.vote_heads h
    left join inc on h.kind = 'income' and inc.vh = h.id
    left join exp on h.kind = 'expense' and exp.vh = h.id
   where h.school_id = v_school
     and (h.is_active or coalesce(inc.n, exp.n, 0) > 0)
  union all
  select null::uuid, 'UNMAPPED', 'Unmapped income', 'income', inc.n::bigint, inc.amt::numeric
    from inc where inc.vh is null
  union all
  select null::uuid, 'UNMAPPED', 'Unmapped spending', 'expense', exp.n::bigint, exp.amt::numeric
    from exp where exp.vh is null
  union all
  select null::uuid, 'UNITEMISED', 'Invoiced but not itemised', 'income', 0::bigint,
         (invoiced.amt - itemised.amt)::numeric
    from invoiced, itemised where invoiced.amt <> itemised.amt
  order by 4, 2;
end;
$$;
revoke all on function public.vote_head_ledger(uuid) from public, anon;
grant execute on function public.vote_head_ledger(uuid) to authenticated;

-- 9. Control totals: ledger vs the source records, for one term or all time. Differences must be 0.00.
create or replace function public.vote_head_reconciliation(p_term_id uuid default null)
returns table (invoiced_total numeric, income_ledger_total numeric, income_difference numeric,
               approved_expense_total numeric, expense_ledger_total numeric, expense_difference numeric)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := auth_school_id();
  v_from date;
  v_to date;
  v_inv numeric;
  v_exp numeric;
  v_il numeric;
  v_el numeric;
begin
  if v_school is null or not auth_has_permission('finance.read')
     or not public.school_has_feature_flag(v_school, 'feature.finance.vote_heads') then
    return;
  end if;
  if p_term_id is not null then
    select start_date, end_date into v_from, v_to from public.terms where id = p_term_id and school_id = v_school;
    if not found then
      return;
    end if;
  end if;
  select coalesce(sum(i.total_amount), 0) into v_inv
    from public.invoices i where i.school_id = v_school and (p_term_id is null or i.term_id = p_term_id);
  select coalesce(sum(e.amount), 0) into v_exp
    from public.expenses e
   where e.school_id = v_school and e.status = 'approved'
     and (p_term_id is null or (coalesce(e.approved_at, e.created_at)::date between v_from and v_to));
  select coalesce(sum(l.amount) filter (where l.kind = 'income'), 0),
         coalesce(sum(l.amount) filter (where l.kind = 'expense'), 0)
    into v_il, v_el
    from public.vote_head_ledger(p_term_id) l;
  return query select v_inv, v_il, v_inv - v_il, v_exp, v_el, v_exp - v_el;
end;
$$;
revoke all on function public.vote_head_reconciliation(uuid) from public, anon;
grant execute on function public.vote_head_reconciliation(uuid) to authenticated;
