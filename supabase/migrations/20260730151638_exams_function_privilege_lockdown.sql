
-- Trigger-only functions should never be callable directly via RPC (they read/write off `new`/`old`
-- row context that doesn't exist outside a trigger). Revoke from both anon and authenticated.
revoke execute on function enforce_exam_structure_lock() from public, anon, authenticated;
revoke execute on function enforce_marks_lock() from public, anon, authenticated;
revoke execute on function resolve_mark_band() from public, anon, authenticated;

-- close_exam/reopen_exam do real writes (unlike the auth_* read-only helpers, which follow existing
-- Phase 0/1 precedent of staying callable-but-self-guarded). Anon has no session, so auth_has_permission
-- would already deny it, but revoking removes the surface area entirely rather than relying on that alone.
revoke execute on function close_exam(uuid) from anon;
revoke execute on function reopen_exam(uuid) from anon;
