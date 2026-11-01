# C2B first live payment: check the transaction id against the STK receipt

**Why this exists.** Paybill (C2B) auto-capture avoids counting a payment twice with one assumption: the
`TransID` Safaricom sends on the C2B notification is the **same string** as the `MpesaReceiptNumber` the STK
push callback returns for the same transaction. The database dedupes on
`payments.method = 'mpesa' AND payments.reference = inbound_payment_events.external_id`
(`c2b_process_event`, migration `20261031203000`). If the two ever differ, an STK-paid fee would be recorded
twice (once by the STK path, once by C2B). This was only ever exercised against the Daraja sandbox, so confirm
it against real money **before relying on live mode**, and re-check after the first few live STK payments.

Nothing here changes data. Run the queries in the Supabase SQL editor. Replace `<SCHOOL_ID>`.

## When to do it
1. The school is `live` on C2B (Finance > Paybill), **or** still `log_only` with real paybill traffic arriving.
2. A parent pays a fee by **STK prompt** (pushed from Finance > M-Pesa) on the production paybill, and the
   same payment also reaches the paybill notification. Pick a payment where the STK push is `completed`.
3. Do the comparison the same day, while the evidence is fresh.

## 1. Compare the two ids for one real payment
Take the M-Pesa code from the STK push (it is on the parent's SMS and in the STK request result), then:

```sql
-- C2B side: what Safaricom sent to the paybill notification
select e.created_at, e.external_id as c2b_transaction_id, e.amount, e.account_reference, e.outcome, e.notes
from inbound_payment_events e
where e.school_id = '<SCHOOL_ID>' and e.provider = 'mpesa_c2b'
  and e.external_id = '<MPESA_CODE>';

-- STK side: what the STK callback recorded
select p.created_at, p.reference as stk_receipt_number, p.amount, p.method, p.status, p.external_provider
from payments p
where p.school_id = '<SCHOOL_ID>' and p.reference = '<MPESA_CODE>';
```

**Pass:** both queries return a row and the two ids are identical (same letters, same case). The C2B event's
`outcome` should be `duplicate` (STK recorded first) or `deferred_to_stk` that later becomes `duplicate`.

## 2. Look for near-misses across all recent payments
This lists C2B events whose amount equals an STK payment recorded within 30 minutes but whose ids differ.
A same-amount coincidence between two different parents is possible, so read each row:

```sql
select e.created_at, e.external_id as c2b_id, p.reference as stk_receipt, e.amount, e.outcome
from inbound_payment_events e
join payments p
  on p.school_id = e.school_id
 and p.external_provider = 'mpesa_daraja'
 and p.amount = e.amount
 and p.created_at between e.created_at - interval '30 minutes' and e.created_at + interval '30 minutes'
where e.school_id = '<SCHOOL_ID>' and e.provider = 'mpesa_c2b'
  and e.external_id <> p.reference
  and e.created_at > now() - interval '7 days'
order by e.created_at desc;
```

**Pass:** no rows, or only rows you can explain as two different parents paying the same amount.

## 3. If the ids differ for the same payment
The dedupe key does not work for this school. **Stop and act in this order:**
1. Finance > Paybill: switch the school back to **Log only**. (Events already parked will still finish
   resolving; that is by design.)
2. Find any payment recorded twice for the same transaction (same amount, same student, two different
   references, within minutes) and reverse the extra one from Finance > Payments.
3. Tell the engineering owner: the dedupe key must change before going live again.

## 4. Record the result
Add the date, school, the pair of ids you compared, and pass/fail to the handover notes.

## Related monitoring (already automatic)
- Events parked as `deferred_to_stk` for **over an hour** raise an alert (Slack + `platform_alerts`) from the
  15-minute resolver (at most hourly) and from a daily Vercel Cron backstop, `/api/cron/c2b-stale-check`.
- `failed` events from the last 30 days appear in a **Needs attention** box on Finance > Paybill and as a count
  on Finance > Reconciliation.
