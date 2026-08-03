
-- Match the existing Phase 0/1 convention for auth helper functions (e.g. auth_user_is_class_teacher_of_stream):
-- callable by authenticated only, not anon. This one had inherited PUBLIC's default grant.
revoke execute on function auth_user_teaches_subject_in_stream(uuid, uuid) from public;
grant execute on function auth_user_teaches_subject_in_stream(uuid, uuid) to authenticated;
