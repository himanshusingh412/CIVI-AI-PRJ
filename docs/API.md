# API

Base path `/api`. JSON in, JSON out. Errors are
`{ error: string, message: string }` with an operator-safe `message` — stack
traces and provider errors are never returned.

**Auth column:**
- `public` — no session
- `session` — any signed-in user
- `staff` — a role, plus the listed permission, plus jurisdiction scope
- `webhook` — HMAC signature

## Config & health

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/config` | public | Public client config: Google client id, demo mode, feature flags, integration modes. Contains no secrets by construction. |
| GET | `/api/health` | public | Store backend, integration modes, staff-directory summary, notification and WhatsApp status. |

## Authentication

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/auth/request-otp` | public | `{ identifier }`. Always returns identical copy. `devOtp` only when `AUTH_DEV_OTP=true` and not production. |
| POST | `/api/auth/verify-otp` | public | `{ identifier, otp }` → session cookie + CSRF token. |
| POST | `/api/auth/google` | public | Google ID token, verified server-side. |
| GET | `/api/auth/session` | session | Current session. |
| POST | `/api/auth/refresh` | session | Rotates the token; absolute expiry is never extended. |
| POST | `/api/auth/logout` | session | Revokes and clears cookies. |

## Identity

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/me` | session | Role, display name, `homeRoute`, permissions, scope, grant source. **The only authority on where a client belongs.** |

## Complaints (citizen)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/complaints` | public | Transparency feed. Names, phones and emails are stripped **server-side**. |
| GET | `/api/complaints/:id` | public | One complaint, same redaction. |
| POST | `/api/complaints` | session | Files one. Duplicate detection is advisory — the complaint is **always** created. |
| POST | `/api/complaints/:id/feedback` | session | `{ rating: 1..5 }`. |
| POST | `/api/complaints/review` | session | Pre-submission AI review. Advisory; never blocks. |
| GET | `/api/complaints/:id/duplicates` | session | Scored near-matches. |

## Media

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/media/:complaintId` | session | Raw image body. Type sniffed by magic number; declared Content-Type ignored. |
| GET | `/api/media/:id` | public | Served with `nosniff` and a generated filename. **No ownership check** — see SECURITY.md. |

## Document verification

All `session`. **Nothing here is written to any database.**

| Method | Path | Notes |
|---|---|---|
| GET | `/api/documents/session` | Current working set, limits, modes. |
| POST | `/api/documents/upload` | Raw body; `x-file-name`, `x-document-type` headers. Max 6 documents, 8 MB each. |
| POST | `/api/documents/remove` | `{ id }`. |
| POST | `/api/documents/clear` | Clears documents, **keeps** the DigiLocker authorisation. |
| POST | `/api/documents/forget` | Discards everything including the authorisation. |
| POST | `/api/documents/verify` | Runs the comparison and returns the report. |

## DigiLocker

All `session`.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/digilocker/status` | Mode and redirect URI. |
| POST | `/api/digilocker/authorize` | Returns an authorize URL. Simulated unless credentials exist. |
| GET | `/api/digilocker/demo-consent` | The simulated consent page. **404 in live mode.** |
| GET | `/api/digilocker/callback` | OAuth return; redirects into the SPA. |
| GET | `/api/digilocker/documents` | Available issued documents. Field **values are not returned** — nothing personal crosses the wire until the citizen chooses. |
| POST | `/api/digilocker/import` | `{ ids }`. Imports only what was ticked. |

## Notifications

All `session`.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/notifications` | Inbox, unread count, preferences. |
| POST | `/api/notifications/read` | `{ id? }`, or all. |
| POST | `/api/notifications/preferences` | Only the keys present are changed. `in_app` cannot be disabled. |

## WhatsApp

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/whatsapp/webhook` | webhook | Meta verification handshake. Returns **plain text**. |
| POST | `/api/whatsapp/webhook` | webhook | Inbound messages. HMAC over raw bytes; replay-protected; always answers 200. |
| GET | `/api/whatsapp/status` | public | Mode, window counts, outbox. No message bodies to identified numbers. |
| POST | `/api/whatsapp/simulate` | dev only | Runs the **real** handler. **404 in production and in live mode.** |

## Admin

All `staff`, all scope-checked. **Out-of-scope reads return 404, not 403.**

| Method | Path | Permission |
|---|---|---|
| GET | `/api/admin/me` | — |
| GET | `/api/admin/complaints` | `complaint:read` |
| GET | `/api/admin/complaints/:id` | `complaint:read` |
| POST | `/api/admin/complaints/:id/status` | per-transition |
| POST | `/api/admin/complaints/:id/assign` | `complaint:assign` |
| POST | `/api/admin/complaints/:id/note` | `complaint:note` |
| GET | `/api/admin/analytics` | `analytics:read` |
| GET | `/api/admin/audit` | `audit:read` |

## Real-time

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/events` | public | Server-sent events. Ids and statuses only — no payloads. |

## Rate limits

See [SECURITY.md](SECURITY.md). Exceeding one returns `429` with
`Retry-After`.
