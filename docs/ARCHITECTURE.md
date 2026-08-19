# Architecture

## Shape

```
                      ┌──────────────────────────────────────┐
   Browser ──────────▶│  Express API (server/)               │
   WhatsApp ─────────▶│                                      │
                      │  auth → rbac → workflow → store      │
                      └───────────────┬──────────────────────┘
                                      │
        ┌─────────────┬───────────────┼───────────────┬──────────────┐
        ▼             ▼               ▼               ▼              ▼
   Postgres      AI providers    OCR adapter    Notification    DigiLocker
   (Neon)        gemini →        gemini-vision   adapters       oauth →
                 bedrock →       → fixture       in-app/email/  simulator
                 claude →                        sms/whatsapp
                 static
```

## The one idea

**Every external dependency sits behind an adapter with a working simulated
counterpart.** Not a stub that throws, not a mock in a test file — a
counterpart that runs the same code path and produces a usable result.

This has three consequences that shaped everything else:

1. The whole product is demonstrable with an empty `.env`.
2. Nothing has to pretend. Because the simulated path is legitimate, it can
   be labelled honestly instead of dressed up (see `server/config.ts`).
3. Swapping a provider is implementing an interface, not a refactor.

## Layers

### `server/config.ts` — the honesty layer
Resolves every integration to `live | demo | config_required | disabled`
from what is actually configured. The only thing that can produce `live` is
the presence of real credentials. `/api/config` serves this to the browser
and `IntegrationBadge` is the only component allowed to render it.

The database entry reports the store's **actual backend**, not the presence
of `DATABASE_URL` — a connection string that is set but unreachable is the
most misleading state this system can be in.

### `server/auth.ts` — stateless sessions
HMAC-signed tokens, not server-side state, because Vercel serverless gives
each invocation a possibly-fresh instance and an in-memory session map logs
people out at random. Sliding expiry with rotation, plus an absolute cap
that refresh never extends.

The session carries a **hash** of the verified identity, never the address
itself. That hash is what every downstream lookup keys on.

### `server/staff.ts` — identity
Answers "is this session staff, and with what jurisdiction?" from the
session's subject hash **and nothing else**. There is no parameter an
attacker can supply that changes the answer.

Resolution order: break-glass env → Postgres `users ⋈ roles ⋈ officers` →
`STAFF_DIRECTORY` env → built-in demo accounts. Break-glass is first on
purpose, so a broken database cannot lock the operator out of their own
portal.

### `server/rbac.ts` — authorisation
Two independent questions, deliberately never conflated:

- **Capability** — may this role perform this action at all?
- **Scope** — is this specific record inside their jurisdiction?

Checking capability alone lets a district admin reassign a complaint in
another state. Checking scope alone lets a read-only auditor mutate records
in their own district. `authorize()` requires both.

### `server/workflow.ts` — the state machine
14 statuses with transitions encoded as data. An invalid jump — submitted
straight to closed, skipping citizen verification — is impossible by
construction rather than by everyone remembering the rule. Each transition
declares the permission it needs and the roles that may perform it.

### `server/store.ts` — persistence behind an interface
In-memory by default, Postgres when `DATABASE_URL` is reachable. Consumers
import a proxy, so the swap happens after async init without anything above
knowing.

### The pipelines

**Document verification** — `ocr.ts` → `matching.ts` → `verify.ts`. Nothing
is persisted; see `documents.ts` for why that is a decision rather than an
omission.

**Notifications** — one entry point, `notify()`, owning template, channel
selection, consent and record. Adding a channel is writing an adapter.

**WhatsApp** — `whatsapp.ts` (transport, consent, the 24-hour window,
signatures, replay) and `whatsappRoutes.ts` (the conversation, which reuses
`handleChat` so a WhatsApp complaint is the same thing as a web complaint).

## Client

Four route trees, each lazily loaded so a citizen never downloads the
administration bundle:

| Route | Bundle |
|---|---|
| `/`, `/login`, `/staff` | main |
| `/portal`, `/portal/report`, `/portal/assistant`, `/portal/documents`, `/portal/settings` | main + per-page chunks |
| `/portal/officer`, `/portal/department`, `/portal/admin` | staff chunks |

`RequireRole` decides what to **render**. It is not a security boundary and
says so in its own doc comment — if you ever find yourself relying on it to
keep data safe, the data has already crossed the network.

## Decisions worth knowing

**Why no framework on the server?** Express plus hand-rolled primitives is
about 3,000 lines and every one of them is inspectable. A grievance portal's
security properties should be readable end to end.

**Why hand-rolled i18n?** Lookup with fallback plus a direction flip is ~40
lines. A 40 kB dependency for that costs more than it returns on a portal
whose users are largely on slow mobile connections.

**Why store complaint images in Postgres?** No extra vendor, no bucket
policy, and it inherits the backups and access control the database already
has. It does not scale past a few GB; `storage_key` exists so the move to
object storage is a backfill, not a schema change.

**Why is the assistant's history in localStorage?** Those transcripts are
the most sensitive text in the product and people write them before deciding
whether to file anything. Keeping them on the device means an unfiled
conversation never becomes a record the state holds.
