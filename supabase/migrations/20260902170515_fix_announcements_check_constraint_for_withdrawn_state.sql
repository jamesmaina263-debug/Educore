-- Bug found via live PR-07/GO-04 verification (withdraw_announcement failing with
-- "new row for relation announcements violates check constraint announcements_check").
-- Applied directly to production first to unblock live testing; this mirrors that
-- same change into migration history.
--
-- The original constraint required status='published' to be logically equivalent to
-- published_at being set. That's correct for draft and published, but wrong for
-- withdrawn: a withdrawn announcement was published first, so it legitimately keeps
-- its published_at (that's the whole point -- "was published on X, withdrawn on Y" is
-- the history withdrawal_reason's own comment describes), while status is no longer
-- 'published'. So (status='published') = (published_at is not null) is false=true for
-- every withdrawn row -- the constraint could never actually allow a withdraw once a
-- row had ever been published, which is every real withdraw. This was latent since
-- the original schema migration; nothing had exercised a live withdraw of a
-- previously-published announcement until this session's PR-07/GO-04 walkthrough.
--
-- Corrected invariant: published_at is null if and only if the row is still a draft.
-- draft -> null (unchanged). published -> not null (unchanged, set by
-- publish_announcement). withdrawn -> not null (was set at publish time and
-- withdraw_announcement never touches it) -- now allowed instead of rejected.
alter table public.announcements drop constraint announcements_check;
alter table public.announcements add constraint announcements_published_at_check
  check ((status = 'draft') = (published_at is null));
