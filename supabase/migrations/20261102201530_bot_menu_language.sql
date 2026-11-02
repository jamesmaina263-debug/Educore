-- Phase 2.7+2.8 (1/2): WhatsApp bot menu and Kiswahili, database core. Additive only; ships dark.
--
-- * New flag feature.bot.menu (catalog entry, enabled for nobody). With the flag off for a school the bot
--   behaves exactly as today: English only, no menu, no language memory.
-- * bot_conversation_language: which language the bot answers a conversation in ('en' or 'sw'). One row
--   per conversation, written only by the service-role functions below.
-- * Existing tables, functions, policies and grants are not touched. whatsapp_conversations is only
--   referenced (foreign key, cascade on delete).
-- Rollback: switch the flag off; nothing else depends on these objects.

-- 1. Flag catalog entry (visible in admin, enabled for nobody).
insert into public.platform_feature_flags (key, label, description)
select 'feature.bot.menu',
       'WhatsApp bot menu and Kiswahili',
       'Gives the WhatsApp bot a numbered menu (fee balance, attendance, documents, absence note, change number, talk to the office) and lets a guardian choose Kiswahili or English. Kiswahili wording should be reviewed by a native speaker before this is enabled for a school. Off by default.'
where not exists (
  select 1 from public.platform_feature_flags where lower(key) = 'feature.bot.menu'
);

-- 2. The language of a conversation.
create table if not exists public.bot_conversation_language (
  conversation_id uuid primary key references public.whatsapp_conversations(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  language text not null check (language in ('en', 'sw')),
  updated_at timestamptz not null default now()
);
comment on table public.bot_conversation_language is
  'Language the WhatsApp bot answers a conversation in (en or sw). Written only by bot_set_language (service role).';
create index if not exists bot_conversation_language_school on public.bot_conversation_language (school_id);

alter table public.bot_conversation_language enable row level security;
revoke all on table public.bot_conversation_language from anon, authenticated;
-- No policies on purpose: clients never read or write this table; only the functions below do.

-- 3. Is the feature on for this school? (service role only)
create or replace function public.bot_menu_enabled(p_school_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(public.school_has_feature_flag(p_school_id, 'feature.bot.menu'), false);
$$;

-- 4. Read the language ('en' when the flag is off, nothing is stored, or the conversation is not this school's).
create or replace function public.bot_get_language(p_school_id uuid, p_conversation_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (select l.language
       from public.bot_conversation_language l
      where l.conversation_id = p_conversation_id
        and l.school_id = p_school_id
        and coalesce(public.school_has_feature_flag(p_school_id, 'feature.bot.menu'), false)),
    'en');
$$;

-- 5. Choose the language for a conversation.
create or replace function public.bot_set_language(p_school_id uuid, p_conversation_id uuid, p_language text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not coalesce(public.school_has_feature_flag(p_school_id, 'feature.bot.menu'), false) then
    return jsonb_build_object('ok', false, 'code', 'flag_off');
  end if;
  if p_language is null or p_language not in ('en', 'sw') then
    return jsonb_build_object('ok', false, 'code', 'bad_language');
  end if;
  if not exists (
    select 1 from public.whatsapp_conversations c
    where c.id = p_conversation_id and c.school_id = p_school_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'bad_conversation');
  end if;

  insert into public.bot_conversation_language (conversation_id, school_id, language)
  values (p_conversation_id, p_school_id, p_language)
  on conflict (conversation_id) do update set language = excluded.language, updated_at = now();

  return jsonb_build_object('ok', true, 'language', p_language);
end;
$$;

-- 6. Grants: service role only (the WhatsApp webhook runs with the service role).
revoke all on function public.bot_menu_enabled(uuid) from public, anon, authenticated;
grant execute on function public.bot_menu_enabled(uuid) to service_role;
revoke all on function public.bot_get_language(uuid, uuid) from public, anon, authenticated;
grant execute on function public.bot_get_language(uuid, uuid) to service_role;
revoke all on function public.bot_set_language(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.bot_set_language(uuid, uuid, text) to service_role;
