
revoke execute on function generate_report_cards(uuid, uuid) from public;
grant execute on function generate_report_cards(uuid, uuid) to authenticated;

-- Re-assert: this should already have been revoked from public in the exams migration, but the
-- advisor is showing anon access again, so re-apply defensively rather than assume.
revoke execute on function auth_user_teaches_subject_in_stream(uuid, uuid) from public;
grant execute on function auth_user_teaches_subject_in_stream(uuid, uuid) to authenticated;
