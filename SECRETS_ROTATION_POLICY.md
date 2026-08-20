# EduCore — Secrets Rotation Policy

**Status:** Policy defined, rotation not yet automated or scheduled — this
document is the starting point (Gap Analysis Tier 2 #16), not a finished
program.

## 1. Current secrets inventory

| Secret | Where it lives | Purpose | Set? |
|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel env vars | Server-side admin operations (signup, cron) | Auto-injected by Supabase for Edge Functions; Vercel copy status unconfirmed (Gap #5) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel env vars | Client-side RLS-respecting requests | Unconfirmed (Gap #5) |
| `GEMINI_API_KEY` | Vercel env vars | AI report-card drafting, Ask Trimora AI | Unconfirmed since Phase 2 |
| `AT_USERNAME` / `AT_API_KEY` | Supabase Edge Function secrets | SMS (Africa's Talking) | Not set — no provider account yet |
| `RESEND_API_KEY` / `RESEND_FROM_ADDRESS` | Supabase Edge Function secrets | Email | Not set — no provider account yet |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_WHATSAPP_FROM` | Supabase Edge Function secrets | WhatsApp | Not set — no provider account yet |
| `CRON_SECRET` | Vercel env vars | Authenticates Vercel Cron calls to `/api/cron/billing` | Unconfirmed — needs manual set (see billing session handover) |
| `ALLOWED_ORIGINS` | Supabase Edge Function secrets | CORS allowlist for `request-otp`/`verify-otp`/`send-communication`/`api-v1` (comma-separated production/staging origins) | **Not yet set — must be set before launch, see pre-launch security audit report.** Unset means every cross-origin browser request is rejected (fails closed, not open), so the app-facing symptom of forgetting this is broken OTP login, not an open CORS hole. |
| Database password | Supabase dashboard | Direct Postgres connections | Not used by the app (only via Supabase client libraries) |
| GitHub PAT | Never stored | Repo clone/commit/push during agent sessions | Provided fresh each session, used once, never persisted |
| `super_admin` account password (Jimmy) | Given in-chat only | Platform admin login | Not stored anywhere — user should rotate via password reset |

## 2. Rotation cadence (recommended, not yet enforced)

- **Provider API keys** (Gemini, Africa's Talking, Resend, Twilio): rotate
  every 12 months or immediately on suspected compromise. These are
  low-blast-radius (each provider can only do what its own scope allows —
  e.g. Gemini can't touch the database).
- **`SUPABASE_SERVICE_ROLE_KEY`**: rotate every 6 months or immediately on
  compromise. This key bypasses RLS entirely — highest blast radius of
  anything in the system. Rotating it means updating it in Vercel and
  re-deploying; Supabase Edge Functions get the new value automatically
  since it's platform-injected there.
- **`CRON_SECRET`**: rotate every 12 months or on compromise — low blast
  radius (only triggers billing maintenance functions, which are themselves
  permission-gated).
- **`ALLOWED_ORIGINS`**: not really a secret (it's a list of public domain
  names, not a credential), so no rotation cadence applies — but it must be
  kept in sync whenever the production or staging domain changes. A stale
  entry just breaks OTP login/comms dispatch from that origin (fails closed);
  a *missing* new-domain entry does the same. Update it as part of any domain
  migration, not on a timer.
- **Database password**: rotate every 12 months even though the app doesn't
  use it directly — anyone with it has unrestricted access.
- **Staff/owner/super_admin account passwords**: user-driven, not a fixed
  schedule — but every account created directly by an agent session (like
  Jimmy's `super_admin` account this session) should be rotated by the
  human owner at first login, since the agent-generated password was
  visible in a chat transcript.

## 3. Rotation procedure (runbook)

1. Generate the new secret at the provider (or `openssl rand -hex 32` for
   internal secrets like `CRON_SECRET`).
2. Add the new value alongside the old one where the provider supports two
   active keys simultaneously (most do) — avoids a hard cutover outage.
3. Update the secret in Vercel (Settings → Environment Variables) or
   Supabase (Edge Functions → Secrets), then redeploy/redeploy functions.
4. Verify the new secret works (a real request through the affected path —
   e.g. send a test SMS, hit `/api/cron/billing` manually with the new
   `CRON_SECRET`).
5. Revoke the old secret at the provider.
6. Log the rotation (date, secret, who did it) — no formal log exists yet;
   a simple dated entry in this file is enough for now.

## 4. What this document does NOT cover yet

- No automated reminder/expiry system exists — rotation today is entirely
  manual and calendar-driven by whoever reads this file.
- No secrets manager (Vault, Doppler, etc.) is in use — everything lives in
  Vercel/Supabase's own env var stores. Fine at this scale, worth revisiting
  if the team managing secrets grows.
- This does not cover M-Pesa/Daraja credentials, since live M-Pesa
  integration hasn't been built yet (flagged since Phase 2 Finance).
