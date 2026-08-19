# Environment variables

Every variable, what happens without it, and whether it is a secret.

`.env.example` is the tracked template. `.env` is git-ignored and must never
be committed. Copy the template, fill in what you have, and leave the rest
empty — **the application runs with an entirely empty `.env`**.

## Required in production

| Variable | Secret | Without it |
|---|---|---|
| `SESSION_SECRET` | **Yes** | Logs an error, uses a per-instance ephemeral secret, and **invalidates every session on restart**. It does not crash — throwing at module load on Vercel kills the whole import chain and every route returns a bare 502. Generate with `openssl rand -base64 48`. Minimum 32 characters. |
| `DATABASE_URL` | **Yes** | In-memory store. Data is lost on restart and not shared across instances. The admin portal shows a warning banner and `/api/config` reports the database as `config_required`. |

## AI

| Variable | Secret | Notes |
|---|---|---|
| `AI_API_KEY` | **Yes** | Gemini. Primary provider, and also what enables real OCR. |
| `AI_MODEL` | No | Default `gemini-3.1-flash-lite`. |
| `AWS_BEARER_TOKEN_BEDROCK` | **Yes** | First fallback. |
| `AWS_REGION`, `BEDROCK_MODEL_ID` | No | |
| `ANTHROPIC_API_KEY` | **Yes** | Second fallback. |
| `CLAUDE_MODEL` | No | |

With none of these the assistant returns deterministic fallbacks and OCR
returns fixtures. Both are labelled Demo.

## Authentication

| Variable | Secret | Notes |
|---|---|---|
| `GOOGLE_CLIENT_ID` | No | Public by design. Also exposed as `VITE_GOOGLE_CLIENT_ID` for the build-time fallback; the authoritative value is served at runtime from `/api/config`. |
| `SUPER_ADMIN_EMAIL` | No | Break-glass. Grants super_admin to this Google identity. |
| `SUPER_ADMIN_PHONE` | No | Break-glass, SMS sign-in. Either one alone is enough. |
| `STAFF_DIRECTORY` | No | JSON array, for deployments with real staff but no database. See `server/staff.ts`. |
| `AUTH_DEV_OTP` | No | Echoes the OTP in the API response. **Ignored when `NODE_ENV=production`.** Needed for the demo accounts. |
| `TURNSTILE_SECRET_KEY` | **Yes** | Without it, a honeypot plus form-timing heuristic is used. |

## Delivery

| Variable | Secret | Notes |
|---|---|---|
| `EMAIL_ENABLED`, `RESEND_API_KEY`, `EMAIL_FROM` | key: **Yes** | Without them, email is logged to the console. |
| `MSG91_AUTH_KEY` *or* `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `TWILIO_FROM_NUMBER` | **Yes** | **SMS is billed per message.** There is no free SMS. |
| `WHATSAPP_ACCESS_TOKEN` | **Yes** | Meta Cloud API. |
| `WHATSAPP_PHONE_NUMBER_ID` | No | |
| `WHATSAPP_VERIFY_TOKEN` | **Yes** | A string you invent. Paste the same value into Meta's webhook screen. |
| `WHATSAPP_APP_SECRET` | **Yes** | Verifies `X-Hub-Signature-256`. **Without it, inbound webhooks cannot be authenticated** — reported at `/api/health` as `signatureVerification: false`. |

## DigiLocker

| Variable | Secret | Notes |
|---|---|---|
| `DIGILOCKER_CLIENT_ID` | No | |
| `DIGILOCKER_CLIENT_SECRET` | **Yes** | |
| `DIGILOCKER_REDIRECT_URI` | No | Defaults to `${PUBLIC_BASE_URL}/api/digilocker/callback`. |

Requires an approved MeitY partner account. Without them the authorisation
flow is simulated against sample documents and labelled Demo everywhere.

## Feature flags

All default **on**, so a fresh clone is fully usable.

`ENABLE_AI`, `ENABLE_OCR`, `ENABLE_VOICE`, `ENABLE_WHATSAPP`, `ENABLE_SMS`,
`ENABLE_DIGILOCKER`, `ENABLE_GOOGLE_OAUTH`, `ENABLE_DOCUMENT_VERIFICATION`

`ENABLE_DEMO_MODE` decides what happens when a credential is **missing**:
simulate the provider (`true`) or report "configuration required" (`false`).
Defaults to `true` outside production and `false` inside it. A production
deploy that wants simulated providers must opt in explicitly — which is
exactly the kind of decision that should require typing it out.

## Other

| Variable | Notes |
|---|---|
| `PUBLIC_BASE_URL` | Used to build webhook and OAuth callback URLs. **No localhost in production.** |
| `PORT` | API port. Default 8787. |
| `NODE_ENV` | `production` disables demo accounts, dev OTP echo and the WhatsApp simulator. |

## Rules

1. **Never put a secret in a `VITE_` variable.** Vite inlines those into the
   client bundle, where anyone can read them with view-source. The only
   `VITE_` variable here is `VITE_GOOGLE_CLIENT_ID`, which is public by design.
2. **Never commit `.env`.** `.gitignore` excludes `.env*` except the template.
3. **A leaked key must be rotated at the provider**, not just deleted from
   the repository. See [SECURITY.md](SECURITY.md).
4. `npm run doctor` reports what is configured without printing any value.
