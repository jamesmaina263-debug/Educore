do $$
declare
  v_user_id uuid;
begin
  select auth_user_id into v_user_id from public.school_users where email = 'christinewangui998@gmail.com';
  if v_user_id is null then
    raise notice 'No matching school_users row found — nothing to revoke.';
    return;
  end if;

  delete from public.school_users where auth_user_id = v_user_id;
  delete from auth.identities where user_id = v_user_id;
  delete from auth.users where id = v_user_id;
end $$;
