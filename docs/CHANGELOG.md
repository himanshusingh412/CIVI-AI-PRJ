# Changelog

## Production upgrade — August 2026

Branch `feat/production-upgrade`.

### Added

**Public landing page.** The application previously opened onto a sign-in
form. The people who most need this service are the least likely to hand
over a phone number to something that has not told them what it does.

**Real staff accounts** (`server/staff.ts`). Role resolves from the session's
subject hash through break-glass env → `users ⋈ roles ⋈ officers` →
`STAFF_DIRECTORY` → built-in demo accounts. Six demo roles are loginable in
non-production.

**Server-decided routing.** `GET /api/me` returns where a session belongs.
The browser follows the answer instead of deriving one.

**Dedicated assistant** at `/portal/assistant` — three-panel layout,
conversation history, and a context panel showing what has been understood
while the conversation happens. Voice input and output in twelve languages
via the browser Web Speech API, with silent fallback to typing.

**AI Document Verification.** OCR adapter (Gemini Vision, with deterministic
fixtures), normalisation and fuzzy matching (`matching.ts`), cross-document
comparison with severity policy (`verify.ts`), and a citizen-facing report.
Nothing is persisted.

**DigiLocker adapter** walking the real OAuth shape, with a simulated
consent screen that says in its first sentence that it is not DigiLocker.

**Guided complaint wizard** at `/portal/report` — six steps plus an advisory
AI review that asks at most three questions and never blocks filing.

**Officer workspace** — a queue ordered by deadline with live SLA
countdowns, replacing the admin dashboard with a filter on it.

**Internal vs public notes** (`POST /api/admin/complaints/:id/note`).
Recording work and reporting progress are different acts.

**Unified notification service** with in-app, email, SMS and WhatsApp
adapters, per-citizen preferences and a working opt-out. All outbound
channels are off by default.

**WhatsApp as an intake channel.** Meta Cloud API abstraction, webhook with
HMAC signature verification and replay protection, conversational intake
reusing the same `handleChat` as the web, the 24-hour messaging window, and
STOP handled before anything else.

**Integration status layer** (`server/config.ts`). Four honest modes derived
from what is configured.

**88 automated tests** and a 23-document documentation set.

### Changed

- Session channel for phone sign-in reported itself as `email` — a value the
  client's own type could not represent.
- `index.html` was still titled "My Google AI Studio App".
- `LanguagePicker`'s `compact` prop was accepted and never used, so every
  caller got the wide variant. That is what overflowed the assistant header
  at 390px.
- Timeline entries showed the raw enum (`officer_assigned`) in the officer
  drawer; now labelled server-side so `STATUS_LABELS` stays the single source
  of truth.
- Queue rows conveyed priority by colour alone. Critical and High are
  adjacent oranges in this palette.
- `validateUpload` and `WhatsAppSendResult` gained explicit `undefined`
  members so `strictNullChecks: false` can narrow them.

### Removed

- **The `x-demo-role` header**, from both server and client. It was gated to
  non-production, but a request header that changes your role is the exact
  shape of the vulnerability this system exists to avoid — and its existence
  meant every reading of the auth code carried an "except in development"
  caveat.
- `RequireAdmin`, superseded by `RequireRole`.

### Fixed

Bugs found by the tests written alongside the features:

1. **A day/month swap reported as a match.** `12/03/2001` and `03/12/2001`
   produce identical candidate sets, so a cross-product found an overlap and
   declared them the same date — the exact failure document verification
   exists to catch.
2. **`M.G. Road` did not match `MG Road`.** Punctuation became whitespace and
   produced a different token count.
3. **STOP's own confirmation was blocked** by the opt-out it had just set, so
   a citizen who opted out heard nothing and had no way to know it worked.
4. **A WhatsApp user could never file if the AI was down.** `readyToFile` is
   model-supplied and the fallback sets it false forever, so the system asked
   for detail indefinitely while recording nothing.
5. **`/documents/clear` revoked the DigiLocker authorisation.** Clearing your
   working set is not the same act as withdrawing consent.
6. **The verification report said "these two documents"** while listing four,
   and joined three names as "A and B and C".

### Security

- Role cannot be influenced by anything the client sends.
- Uploaded filenames are stripped of control characters and bidirectional
  overrides (U+202E makes `annexure-gpj.exe` read as `annexure-exe.jpg`).
- Webhook signatures are verified over the raw request bytes, captured by a
  `verify` hook on the JSON parser.
- Note bodies are never written to the audit log — only visibility and
  length.
- `/api/whatsapp/simulate` and the DigiLocker demo consent screen refuse to
  exist in production or in live mode.

---

## Earlier

See `git log`. Prior work established the Express API, RBAC engine, workflow
state machine, Postgres schema with RLS, audit log, SLA sweeper, SSE
updates, duplicate detection, twelve-language i18n and the admin portal.
