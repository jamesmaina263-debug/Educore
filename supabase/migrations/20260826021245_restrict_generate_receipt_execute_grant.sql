-- generate_receipt(p_payment_id) has no in-body auth check at all and was directly
-- executable by `authenticated`, taking an arbitrary payment_id with no ownership
-- verification. Two impacts: (1) IDOR read -- any authenticated user from any school
-- could read another school's receipt (receipt_number, student_id, school_id) for a
-- guessed/leaked payment_id; (2) IDOR write -- if no receipt existed yet, it would
-- create one for that payment, consuming a number from the global receipt_number_seq,
-- letting an outsider trigger financial record creation for another tenant's payment.
--
-- No app code calls this via RPC at all -- it's purely an internal helper invoked from
-- record_payment() and reconcile_pending_mpesa_payments() (both SECURITY DEFINER,
-- executing as the function owner, so revoking authenticated's direct EXECUTE right
-- doesn't affect those internal calls). Matches the grant pattern already used for other
-- internal-only helpers like ensure_student_financial_account_for_webhook.

revoke all on function public.generate_receipt(uuid) from public, anon, authenticated;
grant execute on function public.generate_receipt(uuid) to service_role;
