-- Security advisor flagged all 4 new SECURITY DEFINER helper functions from this
-- PR as callable by the anon (unauthenticated) role via PostgREST's exposed RPC
-- endpoint. `revoke execute ... from public` (done for 2 of the 4 earlier) does
-- not remove Supabase's separate direct grant to `anon` -- PUBLIC and `anon` are
-- distinct here. Functionally low-risk (auth.uid() is null with no JWT, so every
-- branch of auth_can_view_released_report_card evaluates to false for anon --
-- it can't be used to probe or confirm anything), but not correctly locked down.
-- Explicitly revoking from anon (and public, redundantly, for the 2 that were
-- missed) and granting to authenticated only, matching the intended access model.

revoke execute on function auth_can_view_released_report_card(uuid, uuid) from public, anon;
revoke execute on function auth_can_view_curriculum_strand(uuid) from public, anon;
revoke execute on function auth_can_view_sub_strand_marks(uuid) from public, anon;
revoke execute on function auth_can_view_grading_band_marks(uuid) from public, anon;

grant execute on function auth_can_view_released_report_card(uuid, uuid) to authenticated;
grant execute on function auth_can_view_curriculum_strand(uuid) to authenticated;
grant execute on function auth_can_view_sub_strand_marks(uuid) to authenticated;
grant execute on function auth_can_view_grading_band_marks(uuid) to authenticated;
