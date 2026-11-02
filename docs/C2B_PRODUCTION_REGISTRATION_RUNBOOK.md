# C2B production registration (one school, one time)

Registers a school's paybill confirmation address with Safaricom so paybill payments reach EduCore. It is
done with the `c2b-register-url-prod` edge function. **Production registration is effectively one-time**:
Safaricom has no unregister API. Changing it later means deleting the URLs on the Daraja portal
(Self Service > URL Management) or asking Safaricom (apisupport@safaricom.co.ke, with the production app
name and shortcode). Nothing in this document has been run against a real paybill yet.

## Facts this relies on, and how sure we are
| Fact | Source | Confidence |
|---|---|---|
| Production endpoint is `https://api.safaricom.co.ke/mpesa/c2b/v2/registerurl`; simulate is not available in production | A copy of Safaricom's C2B documentation | Good |
| URLs must be HTTPS and must not contain mpesa, safaricom, exe, exec, cmd, sql, query (and similar); no tunnel services | Same, plus several community guides | Good |
| A registered URL can be deleted on the portal and re-registered | Same copy of the docs (an older article says email Safaricom instead) | **Unconfirmed for our account** |
| Safaricom has enabled C2B for the school's paybill and the Daraja app behind it | Not known | **Unknown** until the real call |
| Safaricom's callback source IPs match our allowlist | Allowlist was corrected from real production STK callbacks only | **Unknown for C2B** |

## Before you start (all must be true)
1. The school has a **paybill** (not a till), production credentials saved at Integrations > M-Pesa, active.
2. The school has loaded its learners with consistent admission numbers, and parents have been told to use the
   admission number as the account number. Otherwise nearly every payment lands as "needs a person".
3. You know **who owns the school's Daraja developer account** and can reach them. They are the only person who
   can delete a registered URL later.
4. `feature.finance.c2b_capture` is on for that school only, and its mode is `log_only`.
5. Ask the school whether any other system (another collection tool, an accounting integration) already
   receives payments for this paybill. If so, **stop**: registering will fail, and deleting their URLs would
   cut that system off.

## 1. Dry run (changes nothing, sends nothing to Register URL)
Get an `aal2` super admin JWT as for the sandbox function, then:

```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/c2b-register-url-prod" \
  -H "Authorization: Bearer $JWT" -H "apikey: $ANON" -H "Content-Type: application/json" \
  -d '{"school_id":"<SCHOOL_ID>"}'
```
`dry_run` defaults to true. Expect `"ready": true`. It also proves the saved key and secret can obtain a
**production** token. Read `would_register.confirmation_and_validation_url`: the secret shows as `<token>`.
If `ready` is false, read `checks.url_problem` and `checks.daraja_token_problem`. Do not continue.

## 2. Register for real
Only after the dry run is clean and the checklist above is true:

```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/c2b-register-url-prod" \
  -H "Authorization: Bearer $JWT" -H "apikey: $ANON" -H "Content-Type: application/json" \
  -d '{"school_id":"<SCHOOL_ID>","dry_run":false,"confirm_shortcode":"<THE_PAYBILL_NUMBER>"}'
```
Expect `"registered": true, "mode": "log_only"`. The function never retries. An audit entry and an alert are written.

## If it does not succeed
- **`already_registered` / `mode_not_log_only` / `not_production` / `till_not_supported` (HTTP 422):** a safety
  check refused. Nothing was sent. Fix the cause named in the message.
- **502 with a hint about existing URLs:** Safaricom thinks URLs already exist. Find out what uses them before
  deleting anything.
- **502 saying the request may not have reached Safaricom (timeout):** open Self Service > URL Management on the
  Daraja portal and check whether the URL is listed. If it is listed, the registration did land: tell
  engineering, who will set `registered_at` by hand. Do not run the real call again.
- **502, any other message:** nothing is recorded as registered. Do not retry until the message is understood.

## After registering
- The school stays in `log_only`. Real payments now arrive and are written down as "would have done"; nothing is
  recorded as a payment. Run it this way for one to two weeks.
- Compare the Finance > Paybill list with the school's M-Pesa statement. A payment on the statement that is
  missing from the list usually means the callback came from an address we reject: look for the alert
  "C2B confirmation rejected: IP outside Safaricom allowlist" and tell engineering the address.
- Before going live, do the real-money check in `docs/C2B_FIRST_LIVE_PAYMENT_RUNBOOK.md`.
- Going live is the school owner's decision, by typing `LIVE` on Finance > Paybill.

## Changing or removing a registered URL
Delete it on the Daraja portal (Self Service > URL Management) as the account owner, or email Safaricom. Then
tell engineering: `mpesa_c2b_config.registered_at` must be cleared before the function will allow a new
registration, and the school must be back in `log_only`.
