-- Reconstructed from live schema introspection (Supabase project alzqlvfaftwegptfbfej).
-- Original SQL never committed to the repo. Current live UPDATE policy has an identical
-- USING and WITH CHECK clause — closing what was presumably a gap where WITH CHECK was
-- missing or looser than USING, which would have let an authorized update move a row's
-- school_id/recorded_by/discipline.write gate out from under the very check that allowed it.

DROP POLICY IF EXISTS discipline_records_update ON public.discipline_records;
CREATE POLICY discipline_records_update ON public.discipline_records
  FOR UPDATE
  USING (
    school_id = auth_school_id()
    AND (
      auth_has_permission('discipline.read_any')
      OR recorded_by = (SELECT su.id FROM school_users su WHERE su.auth_user_id = auth.uid())
    )
    AND auth_has_permission('discipline.write')
  )
  WITH CHECK (
    school_id = auth_school_id()
    AND (
      auth_has_permission('discipline.read_any')
      OR recorded_by = (SELECT su.id FROM school_users su WHERE su.auth_user_id = auth.uid())
    )
    AND auth_has_permission('discipline.write')
  );
