# CivicAI

**An AI-assisted citizen grievance platform for Indian government services.**

Report a civic problem, check what a scheme requires, verify your documents
before you apply, and follow every step until it is resolved — in twelve
languages, on any device, by web or WhatsApp.

---

## The problem

Two things make government services hard to use, and neither is a technology
problem:

1. **You cannot tell what happened to your complaint.** It goes into an
   office and comes out weeks later, or not at all, with no way to find out
   who holds it or when it is due.
2. **Applications get rejected weeks after submission** over a name spelled
   differently on two documents, or a date of birth in the other convention.
   The information needed to prevent that was in the citizen's own hands the
   whole time.

CivicAI attacks both: every complaint has a reference, an accountable
officer, a deadline and a public timeline; and documents can be checked
against each other **before** anything is submitted.

---

## What is actually live

The single most important thing in this README. Every integration reports
one of four honest modes, derived from what is actually configured — never
from a status a component asserts by hand. The UI shows the same badge.

| Integration | Without configuration | With configuration | Notes |
|---|---|---|---|
| **AI assistant** | 🔵 Demo (canned fallbacks) | ✅ Live (Gemini → Bedrock → Claude failover) | `AI_API_KEY` |
| **Document OCR** | 🔵 Demo (deterministic fixtures) | ✅ Live (Gemini Vision) | reuses `AI_API_KEY` |
| **Database** | 🟡 In-memory, non-durable | ✅ Live (Neon Postgres) | `DATABASE_URL` |
| **Google sign-in** | 🟡 Configuration required | ✅ Live | `GOOGLE_CLIENT_ID` |
| **OTP sign-in** | ✅ Live (codes logged, not sent) | ✅ Live (delivered) | codes are always real |
| **SMS delivery** | 🔵 Demo (console) | ✅ Live (MSG91 / Twilio) | **billed per message** |
| **Email delivery** | 🔵 Demo (console) | ✅ Live (Resend) | `RESEND_API_KEY` |
| **WhatsApp** | 🔵 Demo (simulated outbox) | 🟡 Configuration required | Meta Cloud API |
| **DigiLocker** | 🔵 Demo (sample documents) | 🟡 Configuration required | needs a MeitY partner account |
| **Voice** | ✅ Live (browser Web Speech) | — | no server credential |

**Nothing is labelled LIVE that has not been wired to a real provider.**
Simulated integrations say "Demo" everywhere they appear, including on the
DigiLocker consent screen, whose first sentence is that it is not DigiLocker.

Two integrations are marked 🟡 rather than ✅ even with credentials, and the
reason is deliberate:

- **DigiLocker** — the OAuth flow is implemented, but the issued-documents
  response parser has never received a real partner response. Rather than
  ship a parser written against a guessed shape, the live path returns
  `501 Not Implemented` with an explanation. See `server/digilocker.ts`.
- **WhatsApp** — fully implemented against the documented Cloud API, but not
  yet tested against a live Meta business account.

---

## Features

### For citizens
- **File a complaint** by guided form, conversation, or WhatsApp
- **AI Document Verification** — cross-check your documents before applying
- **Track to resolution** — every status change, timestamped, with the
  responsible officer and the deadline
- **Voice input** in twelve languages, running in the browser
- **Notifications** you choose, on channels you switch on

### For staff
- **Officer workspace** — a queue ordered by deadline with live countdowns
- **Department administration** — queue plus analytics, scoped to jurisdiction
- **System administration** — cross-department analytics and the audit log
- **14-state workflow** where illegal transitions are impossible by construction
- **Tamper-evident audit log** with hash chaining

---

## Quick start

```bash
git clone <this repository>
cd civicai
npm install
cp .env.example .env      # then edit — see docs/ENVIRONMENT.md
npm run dev:full          # API on :8787, web on :3000
```

Open <http://localhost:3000>. Everything works with an empty `.env`; the
integration table above describes what you get.

```bash
npm run lint     # tsc --noEmit
npm test         # 88 tests, no external services required
npm run build    # production bundle
npm run verify   # all three
```

---

## Demo accounts

Set `AUTH_DEV_OTP=true` in `.env`. The one-time code comes back in the API
response, so you can sign in as any role in about ten seconds.

| Phone | Role | Sees |
|---|---|---|
| `9000000001` | Super admin | Everything |
| `9000000002` | State admin | Delhi only |
| `9000000003` | District admin | Delhi / New Delhi only |
| `9000000004` | Department officer | Delhi / Water Department only |
| `9000000005` | Field officer | Only cases assigned to them |
| `9000000006` | Auditor | Everything, read-only, contact details masked |

Any other number signs in as a citizen.

**These accounts do not exist in production.** They require
`NODE_ENV !== 'production'` **and** demo mode; both guards are checked in
`server/staff.ts`. There is no header, query parameter or request body that
can grant a role — see [SECURITY.md](docs/SECURITY.md).

---

## Architecture at a glance

```
Browser ──┐
WhatsApp ─┼──▶ Express API ──▶ Postgres (Neon)
          │         │
          │         ├──▶ AI providers (Gemini → Bedrock → Claude → static)
          │         ├──▶ OCR adapter (Gemini Vision → fixture)
          │         ├──▶ Notification adapters (in-app / email / SMS / WhatsApp)
          │         └──▶ DigiLocker adapter (OAuth → simulator)
          └──▶ React SPA (citizen · officer · department · admin)
```

Every external dependency sits behind an adapter with a simulated
counterpart, so the whole product is demonstrable with no credentials at all
and nothing has to pretend.

Full detail: [ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Roles and routing

After sign-in the browser asks `GET /api/me` where it belongs and follows the
answer. It never derives a route from a role it holds locally.

| Role | Lands on |
|---|---|
| Citizen | `/portal` |
| Field officer | `/portal/officer` |
| Department officer, District admin | `/portal/department` |
| State admin, Super admin, Auditor | `/portal/admin` |

Routing is convenience. **Authorisation is enforcement** — every screen
behind those routes fetches through endpoints that re-check capability and
jurisdiction on every single request. A user who edits the URL gets a screen
that refuses to fill itself, not a leak.

---

## Documentation

| Document | What it covers |
|---|---|
| [PRD.md](docs/PRD.md) | The problem, who it is for, what success looks like |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design and the decisions behind it |
| [TECH_STACK.md](docs/TECH_STACK.md) | What is used and why |
| [DATABASE.md](docs/DATABASE.md) | Schema, RLS, and what is deliberately not stored |
| [API.md](docs/API.md) | Every endpoint, with auth requirements |
| [FEATURES.md](docs/FEATURES.md) | Feature-by-feature status |
| [USER_FLOW.md](docs/USER_FLOW.md) | Citizen, officer and admin journeys |
| [UI_GUIDELINES.md](docs/UI_GUIDELINES.md) | Design tokens, motion, accessibility rules |
| [CODING_RULES.md](docs/CODING_RULES.md) | Conventions this codebase actually follows |
| [FILE_STRUCTURE.md](docs/FILE_STRUCTURE.md) | Where things live |
| [SECURITY.md](docs/SECURITY.md) | Threat model, controls, and known gaps |
| [ENVIRONMENT.md](docs/ENVIRONMENT.md) | Every environment variable |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | Vercel deployment, step by step |
| [TESTING.md](docs/TESTING.md) | What is tested and what is not |
| [DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) | The end-to-end demonstration |
| [PPT_CONTENT.md](docs/PPT_CONTENT.md) | Slide content for a presentation |
| [FAQ.md](docs/FAQ.md) | Questions a reviewer will ask |
| [ROADMAP.md](docs/ROADMAP.md) | What comes next |
| [TASKS.md](docs/TASKS.md) | Outstanding work |
| [PROMPTS.md](docs/PROMPTS.md) | Every AI prompt, and the rules they enforce |
| [CHANGELOG.md](docs/CHANGELOG.md) | What changed |
| [BACKEND.md](docs/BACKEND.md) | Backend notes (pre-existing) |
| [DESIGN.md](docs/DESIGN.md) | Visual identity (pre-existing) |

---

## Known limitations

Stated plainly, because a prototype that hides these is worse than one that
does not have the features.

1. **Several stores are in-memory.** OTP state, verification sessions,
   DigiLocker authorisations, notification preferences and WhatsApp
   conversation state live in process memory. They do not survive a restart
   and are not shared across serverless instances. Redis is the fix; the
   trade-off is documented at each site.
2. **Document verification stores nothing at all.** This is deliberate (see
   `server/documents.ts`), but it means a session is lost on restart.
3. **DigiLocker live mode is not implemented past authorisation.**
4. **WhatsApp has not been tested against a real Meta account.**
5. **Attachments over WhatsApp are not accepted** — downloading an
   attacker-supplied file from an unauthenticated webhook needs its own
   review.
6. **The citizen dashboard collapses 14 workflow states into 4 buckets.**
   The seam is `src/services/complaintAdapter.ts`, which documents the loss.
7. **SMS costs money.** There is no free SMS. The UI says so.

---

## Licence

See [LICENSE.md](docs/LICENSE.md).
