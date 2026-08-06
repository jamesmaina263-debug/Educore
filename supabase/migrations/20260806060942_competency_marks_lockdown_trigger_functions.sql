-- Trigger functions should never be directly callable as RPCs, same lockdown
-- already applied to enforce_marks_lock/resolve_mark_band.
revoke execute on function public.enforce_competency_marks_lock() from public, anon, authenticated;
revoke execute on function public.validate_competency_band() from public, anon, authenticated;
