# Features

✅ working · 🔵 demo mode · 🟡 configuration required · 🔴 blocked

## Citizen

| Feature | Status | Notes |
|---|---|---|
| Public landing page | ✅ | Readable without an account |
| Email / phone OTP sign-in | ✅ | Codes always real; delivery varies |
| Google sign-in | 🟡 | Needs `GOOGLE_CLIENT_ID` |
| Guided complaint wizard | ✅ | 6 steps + AI review |
| Conversational filing | ✅ | 🔵 without an AI key |
| Voice dictation | ✅ | Browser Web Speech; hidden where unsupported |
| Location: GPS, address, map pin | ✅ | |
| Photo evidence | ✅ | Max 3, 5 MB each, magic-number sniffed |
| Pre-submission AI review | ✅ | Advisory; never blocks |
| Duplicate detection | ✅ | Advisory; never auto-merges |
| Complaint tracking | ✅ | Live over SSE |
| **Document verification** | ✅ | 🔵 OCR without an AI key |
| DigiLocker import | 🔵 | Real OAuth shape, sample documents |
| Notification preferences | ✅ | All outbound channels opt-in |
| In-app inbox | ✅ | Always on, by design |
| 12 languages incl. RTL | ✅ | Citizen surfaces; admin is English |
| Dark mode | ✅ | |

## Staff

| Feature | Status | Notes |
|---|---|---|
| Role-based routing | ✅ | Server-decided |
| Officer queue with SLA countdowns | ✅ | Ordered by deadline |
| Jurisdiction scoping | ✅ | Enforced per request |
| Workflow transitions | ✅ | 14 states, role-gated |
| Internal vs public notes | ✅ | Defaults to internal |
| Citizen evidence viewer | ✅ | |
| Department analytics | ✅ | |
| System analytics | ✅ | |
| Audit log | ✅ | Hash-chained |
| Contact-detail redaction | ✅ | Auditors see masked values |
| Officer assignment | ✅ | |
| SLA escalation sweep | ✅ | Every 5 minutes |

## Channels

| Channel | Status | Notes |
|---|---|---|
| Web | ✅ | |
| WhatsApp intake | 🔵 | Handler is real; simulated transport |
| WhatsApp notifications | 🔵 | 24-hour window + templates modelled |
| SMS | 🔵 → ✅ | **Billed per message** |
| Email | 🔵 → ✅ | Resend |
| In-app | ✅ | |

## Platform

| Feature | Status | Notes |
|---|---|---|
| Postgres persistence | 🟡 → ✅ | In-memory without `DATABASE_URL` |
| Row-level security policies | ✅ | Present; not covered by automated tests |
| Stateless sessions | ✅ | |
| Rate limiting | ✅ | Per surface |
| CSRF (double-submit) | ✅ | |
| Bot protection | ✅ | Honeypot + timing; Turnstile optional |
| AI provider failover | ✅ | Gemini → Bedrock → Claude → static |
| Integration status layer | ✅ | Four honest modes |
| Vercel deployment | ✅ | |
| 88 automated tests | ✅ | |

## Deliberately absent

| Not built | Why |
|---|---|
| Automated application approval | Not a decision software should make |
| Document editing | Never, under any circumstance |
| Identity verification against a registry | Needs authority this does not have |
| Payments | Out of scope |
| Merging complaints automatically | Breaks the one promise: your complaint exists |
| WhatsApp attachments | Downloading attacker-supplied files from an unauthenticated webhook needs its own review |
