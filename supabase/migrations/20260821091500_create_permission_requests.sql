-- Issue 3: users can request additional permissions from an admin; the
-- permission is only actually granted once an admin approves it. Modeled
-- closely on leave_requests (request -> pending -> admin approves/rejects)
-- and on the existing request_discount/approve_discount SECURITY DEFINER
-- pair for the approval side.
CREATE TABLE public.permission_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id),
  school_user_id uuid NOT NULL REFERENCES public.school_users(id),
  permission_key text NOT NULL,
  reason text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  reviewed_by uuid REFERENCES public.school_users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX permission_requests_school_id_idx ON public.permission_requests(school_id);
CREATE INDEX permission_requests_school_user_id_idx ON public.permission_requests(school_user_id);
-- Prevent piling up duplicate pending requests for the same permission.
CREATE UNIQUE INDEX permission_requests_one_pending_per_key
  ON public.permission_requests(school_user_id, permission_key)
  WHERE status = 'pending';

ALTER TABLE public.permission_requests ENABLE ROW LEVEL SECURITY;

-- Same visibility shape as leave_requests_select: the requester sees their
-- own requests, and anyone who can manage permissions sees all of them for
-- their school.
CREATE POLICY permission_requests_select ON public.permission_requests
  FOR SELECT
  USING (
    auth_is_super_admin()
    OR (school_id = auth_school_id() AND auth_has_permission('settings.roles.manage'))
    OR (school_user_id = auth_school_user_id())
  );

-- Requesters can only ever insert a row for themselves, in their own school.
-- (The actual grant only ever happens via respond_to_permission_request()
-- below, never directly through this table -- there is deliberately no
-- INSERT path that sets status to anything but the 'pending' default.)
CREATE POLICY permission_requests_insert ON public.permission_requests
  FOR INSERT
  WITH CHECK (
    school_id = auth_school_id()
    AND school_user_id = auth_school_user_id()
  );

-- Requesters can cancel their own still-pending request (mirrors
-- leave_requests_update_own_pending). Approving/rejecting happens only
-- through respond_to_permission_request(), never a direct table UPDATE, so
-- there is no admin UPDATE policy here.
CREATE POLICY permission_requests_cancel_own_pending ON public.permission_requests
  FOR UPDATE
  USING (school_user_id = auth_school_user_id() AND status = 'pending')
  WITH CHECK (school_user_id = auth_school_user_id() AND status = 'cancelled');

-- Request an additional permission. Any active school_user can call this for
-- themselves; no special permission is required to *ask*, only to approve.
CREATE OR REPLACE FUNCTION public.request_permission(p_permission_key text, p_reason text DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_school_id uuid := auth_school_id();
  v_school_user_id uuid := auth_school_user_id();
  v_request_id uuid;
begin
  if v_school_user_id is null then
    raise exception 'Could not resolve your account.';
  end if;
  if auth_has_permission(p_permission_key) then
    raise exception 'You already have this permission.';
  end if;
  if exists (
    select 1 from permission_requests
    where school_user_id = v_school_user_id
      and permission_key = p_permission_key
      and status = 'pending'
  ) then
    raise exception 'You already have a pending request for this permission.';
  end if;

  insert into permission_requests (school_id, school_user_id, permission_key, reason)
  values (v_school_id, v_school_user_id, p_permission_key, p_reason)
  returning id into v_request_id;

  return v_request_id;
end;
$function$;

-- Approve or reject a pending request. Only actually grants the permission
-- (via user_permission_overrides) when approved -- never on request/insert.
-- Preserves the same "can't grant what you don't hold yourself" invariant
-- that user_permission_overrides_write already enforces for manual grants,
-- so this new pathway can't be used to escalate past that rule.
CREATE OR REPLACE FUNCTION public.respond_to_permission_request(p_request_id uuid, p_approve boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_school_id uuid := auth_school_id();
  v_reviewer uuid := auth_school_user_id();
  v_permission_key text;
  v_target_school_user_id uuid;
begin
  if not auth_has_permission('settings.roles.manage') then
    raise exception 'Not authorized to manage permission requests.';
  end if;

  select permission_key, school_user_id into v_permission_key, v_target_school_user_id
  from permission_requests
  where id = p_request_id and school_id = v_school_id and status = 'pending';

  if v_permission_key is null then
    raise exception 'Request not found or not pending.';
  end if;

  if p_approve and not auth_has_permission(v_permission_key) then
    raise exception 'You can''t grant a permission you don''t hold yourself.';
  end if;

  update permission_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      reviewed_by = v_reviewer,
      reviewed_at = now()
  where id = p_request_id;

  if p_approve then
    insert into user_permission_overrides (school_id, school_user_id, permission_key, allowed, granted_by)
    values (v_school_id, v_target_school_user_id, v_permission_key, true, v_reviewer)
    on conflict (school_user_id, permission_key) do update set allowed = true, granted_by = v_reviewer;
  end if;

  insert into audit_log (school_id, actor_school_user_id, table_name, record_id, action, new_data)
  values (
    v_school_id, v_reviewer, 'permission_requests', p_request_id,
    case when p_approve then 'approve' else 'reject' end,
    jsonb_build_object('permission_key', v_permission_key, 'status', case when p_approve then 'approved' else 'rejected' end)
  );
end;
$function$;
