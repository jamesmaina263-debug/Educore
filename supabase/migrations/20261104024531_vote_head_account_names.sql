-- WP 6.3 (1/2): a ledger account name per vote head, for file-based accounting exports. Additive; dark behind the
-- existing flag feature.finance.vote_heads (WP 6.2). No existing function or policy changes.
--
-- The export (QuickBooks / Sage style CSV, built by the app) must post to account names that already exist in the
-- school's accounting package, so each vote head can carry the exact account name to use. The name is optional;
-- the export refuses to run for any vote head that has activity but no account name.

alter table public.vote_heads
  add column if not exists account_name text
  check (account_name is null or char_length(btrim(account_name)) between 1 and 120);
comment on column public.vote_heads.account_name is
  'Exact account name in the school''s accounting package, used by the accounting export. Set only by set_vote_head_account().';

create or replace function public.set_vote_head_account(p_vote_head_id uuid, p_account_name text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_school uuid := auth_school_id();
  v_name text := nullif(btrim(coalesce(p_account_name, '')), '');
begin
  if v_school is null or not auth_has_permission('finance.write') then
    raise exception 'Not authorized to manage vote heads.' using errcode = '42501';
  end if;
  if not public.school_has_feature_flag(v_school, 'feature.finance.vote_heads') then
    raise exception 'Vote heads are not enabled for this school.' using errcode = '55000';
  end if;
  if v_name is not null and char_length(v_name) > 120 then
    raise exception 'Account name is too long.' using errcode = '22023';
  end if;
  update public.vote_heads set account_name = v_name where id = p_vote_head_id and school_id = v_school;
  if not found then
    raise exception 'Vote head not found.' using errcode = '22023';
  end if;
end;
$$;
revoke all on function public.set_vote_head_account(uuid, text) from public, anon;
grant execute on function public.set_vote_head_account(uuid, text) to authenticated;
