-- ============================================================================
-- Announcements -- PA-08: attachments
--
-- One new table (announcement_attachments) + a private storage bucket. Same
-- write model as everything else in this module: no client write policy on
-- the table, all writes through record_announcement_attachment(); the
-- storage bucket itself has write RLS matching announcements.publish/
-- ownership, mirroring how application-documents' bucket policies are keyed
-- off the requester's role rather than left open.
--
-- Reuses auth_is_announcement_recipient() / auth_can_manage_announcement()
-- from 20260901032241_fix_announcements_rls_infinite_recursion.sql for both
-- the table's RLS and the storage bucket's RLS, rather than re-deriving the
-- same cross-table check a third time -- that recursion bug is exactly what
-- those two functions exist to prevent, so any new policy touching both
-- announcements and announcement_recipients should go through them.
-- ============================================================================

create table announcement_attachments (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references announcements(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  file_size bigint,
  content_type text,
  uploaded_by uuid not null references school_users(id),
  created_at timestamptz not null default now()
);

create index idx_announcement_attachments_announcement_id on announcement_attachments(announcement_id);

alter table announcement_attachments enable row level security;

create policy announcement_attachments_select on announcement_attachments
for select
using (
  auth_can_manage_announcement(announcement_id)
  or exists (
    select 1 from announcements a
    where a.id = announcement_attachments.announcement_id
      and a.status = 'published'
      and auth_is_announcement_recipient(a.id)
  )
);

-- ----------------------------------------------------------------------------
-- record_announcement_attachment: called right after a successful upload to
-- the announcement-attachments bucket. Only on a draft or already-published
-- announcement the caller can manage (not withdrawn -- adding material to a
-- retracted notice makes no sense and would be invisible to guardians
-- anyway, since the withdrawn UI doesn't render attachments).
-- ----------------------------------------------------------------------------

create or replace function public.record_announcement_attachment(
  p_announcement_id uuid,
  p_storage_path text,
  p_file_name text,
  p_file_size bigint,
  p_content_type text
)
returns public.announcement_attachments
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth_school_user_id();
  v_a public.announcements;
  v_row public.announcement_attachments;
begin
  if v_caller is null then
    raise exception 'no active school session';
  end if;

  select * into v_a from public.announcements where id = p_announcement_id;
  if v_a.id is null then
    raise exception 'announcement not found';
  end if;
  if v_a.status = 'withdrawn' then
    raise exception 'this announcement has been withdrawn';
  end if;
  if not auth_can_manage_announcement(p_announcement_id) then
    raise exception 'insufficient permissions to attach files to this announcement';
  end if;
  if p_storage_path is null or btrim(p_storage_path) = '' then
    raise exception 'storage_path is required';
  end if;
  if p_file_name is null or btrim(p_file_name) = '' then
    raise exception 'file_name is required';
  end if;

  insert into public.announcement_attachments (announcement_id, storage_path, file_name, file_size, content_type, uploaded_by)
  values (p_announcement_id, p_storage_path, p_file_name, p_file_size, p_content_type, v_caller)
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.record_announcement_attachment(uuid, text, text, bigint, text) from public, anon;
grant execute on function public.record_announcement_attachment(uuid, text, text, bigint, text) to authenticated;

create or replace function public.delete_announcement_attachment(p_attachment_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row public.announcement_attachments;
  v_path text;
begin
  select * into v_row from public.announcement_attachments where id = p_attachment_id;
  if v_row.id is null then
    raise exception 'attachment not found';
  end if;
  if not auth_can_manage_announcement(v_row.announcement_id) then
    raise exception 'insufficient permissions to remove this attachment';
  end if;

  v_path := v_row.storage_path;
  delete from public.announcement_attachments where id = p_attachment_id;
  return v_path; -- caller (server action) still needs to remove the storage object itself
end;
$$;

revoke all on function public.delete_announcement_attachment(uuid) from public, anon;
grant execute on function public.delete_announcement_attachment(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Storage bucket. Object keys: {school_id}/{announcement_id}/{ts}-{safe name}
-- -- same convention as application-documents.
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('announcement-attachments', 'announcement-attachments', false)
on conflict (id) do nothing;

create policy announcement_attachments_storage_write on storage.objects
for insert with check (
  bucket_id = 'announcement-attachments'
  and (storage.foldername(name))[1]::uuid = auth_school_id()
  and auth_can_manage_announcement(((storage.foldername(name))[2])::uuid)
);

create policy announcement_attachments_storage_select on storage.objects
for select using (
  bucket_id = 'announcement-attachments'
  and (
    auth_can_manage_announcement(((storage.foldername(name))[2])::uuid)
    or exists (
      select 1 from announcements a
      where a.id = ((storage.foldername(name))[2])::uuid
        and a.status = 'published'
        and auth_is_announcement_recipient(a.id)
    )
  )
);

create policy announcement_attachments_storage_delete on storage.objects
for delete using (
  bucket_id = 'announcement-attachments'
  and auth_can_manage_announcement(((storage.foldername(name))[2])::uuid)
);
