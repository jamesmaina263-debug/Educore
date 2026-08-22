-- Guard against double-dispatch: without this, calling mpesa_stk_request_dispatched twice for
-- the same request_id would silently overwrite checkout_request_id, and (since the edge
-- function has no other idempotency check) could result in a second real STK prompt being sent
-- to the customer's phone for the same invoice if invoked twice.
create or replace function public.mpesa_stk_request_dispatched(
  p_request_id uuid,
  p_checkout_request_id text,
  p_merchant_request_id text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update public.mpesa_stk_requests
  set checkout_request_id = p_checkout_request_id,
      merchant_request_id = p_merchant_request_id
  where id = p_request_id and status = 'pending' and checkout_request_id is null;

  if not found then
    raise exception 'STK request not found, already resolved, or already dispatched.';
  end if;
end;
$function$;
