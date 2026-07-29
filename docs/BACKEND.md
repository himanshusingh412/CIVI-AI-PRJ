# CivicAI Backend

Express API that keeps AI keys off the client, authenticates citizens, and hard-caps AI usage.

## Run

```bash
npm install
npm run dev:full     # backend (8787) + Vite (3000)
```

Or separately: `npm run server` and `npm run dev`.

## Environment (`.env`)

| Key | Purpose |
|-----|---------|
| `AI_API_KEY` | Gemini key (primary provider) |
| `AI_MODEL` | Default `gemini-3.1-flash-lite` |
| `ANTHROPIC_API_KEY` | **Optional** — enables Claude failover when Gemini quota runs out |
| `CLAUDE_MODEL` | Default `claude-haiku-4-5-20251001` |
| `AUTH_DEV_OTP` | `true` returns the OTP in the API response (demo only — **remove in production**) |
| `SMS_ENABLED` | `true` sends real SMS via MSG91; `false` logs to console |
| `MSG91_AUTH_KEY` | Auth key from the MSG91 dashboard |
| `MSG91_TEMPLATE_ID` | DLT-approved OTP template ID |
| `MSG91_SENDER_ID` | 6-char sender ID, default `CIVCAI` |
| `PORT` | Default `8787` |

## Turning on real SMS

1. Create an account at [msg91.com](https://msg91.com) and add credit.
2. **Dashboard → Auth Key** → copy into `MSG91_AUTH_KEY`.
3. **Dashboard → SMS → Templates** → create an OTP template containing `##OTP##`, e.g.
   `Your CivicAI verification code is ##OTP##. Valid for 5 minutes. Do not share it.`
4. India requires **DLT registration** (TRAI rule) — register your entity and template on
   your telecom operator's DLT portal, then link the approved template in MSG91. Approval
   usually takes 1–2 days.
5. Copy the template ID into `MSG91_TEMPLATE_ID`, set `SMS_ENABLED=true`, and set
   `AUTH_DEV_OTP=false`.
6. Restart the server. `GET /api/health` should show `sms.provider: "msg91"`.

Until then the server runs in console mode: the OTP is printed to the terminal and (with
`AUTH_DEV_OTP=true`) returned in the API response, so the demo works with no gateway.

Delivery is attempted **before** the OTP is stored — if MSG91 rejects the send, no attempt
is consumed and the citizen sees a clear error.

## Endpoints

| Method | Route | Auth | Rate limit |
|--------|-------|------|-----------|
| POST | `/api/auth/request-otp` | — | 10 / 15 min per IP |
| POST | `/api/auth/verify-otp` | — | 20 / 15 min per IP |
| POST | `/api/auth/logout` | Bearer | — |
| GET | `/api/auth/session` | Bearer | — |
| POST | `/api/chat` | Bearer | 15 / min per session |
| POST | `/api/analyze-complaint` | Bearer | 10 / min per session |
| POST | `/api/response-templates` | Bearer | 10 / min per session |
| GET | `/api/health` | — | — |

## Login

Passwordless OTP sign-in with **either an email address or an Indian mobile number** —
no Aadhaar required. The server auto-detects the channel: anything containing `@` is
treated as email, everything else as a phone number (10 digits starting 6–9, accepting
`+91`/`91`/`0` prefixes).

| Limit | Value |
|-------|-------|
| OTP length | 6 digits |
| OTP validity | 5 minutes |
| Wrong-OTP attempts | **9**, then 15-min lockout |
| Code requests | 5 per identifier per 15 min |
| Resend cooldown | 30 seconds |
| Session lifetime | 1 hour |

OTPs are stored as SHA-256 hashes and compared with `timingSafeEqual`. A successful
verification burns the code immediately. Delivery is attempted **before** the code is
stored, so a gateway failure never consumes one of the citizen's sends.

### Email delivery (Resend)

1. Sign up at [resend.com](https://resend.com) and create an API key.
2. Set `RESEND_API_KEY`, `EMAIL_FROM` (a verified sender domain), and `EMAIL_ENABLED=true`.
3. Without a key the server prints the code to the console instead.

## AI overflow protection

Every AI call passes through `withGuards()` in `server/limits.ts`:

| Guard | Value |
|-------|-------|
| Input per message | 2,000 chars |
| Conversation history | 12 turns / 6,000 chars |
| Output tokens | 512 |
| Concurrent calls | 4 (others queue up to 8s) |
| Daily budget — global | 400 requests (free tier is 500) |
| Daily budget — per session | 60 requests |
| Request timeout | 20 seconds |
| HTTP body size | 64 KB |

**Failure ladder:** Gemini → Claude (if configured) → static fallback. The app never breaks; it degrades. Responses carry `provider` and `degraded` so the UI can show the current mode.

## Live map

`/api/chat` returns a `location` object alongside the reply. Locations resolve in this order:

1. Named landmark from the table in `server/chat.ts` (`exact`)
2. `Sector N` pattern → deterministic offset from city center (`approximate`)
3. Browser GPS, if the citizen granted permission (`exact`)
4. City center fallback (`city`)

The chat UI drops a colour-coded pin per extracted location (red = Critical → green = Low) and keeps the last 10.

## Files

```
server/
  index.ts      routes, rate limiters, wiring
  auth.ts       Aadhaar validation, OTP lifecycle, sessions
  limits.ts     budget, concurrency, input clamping
  providers.ts  Gemini + Claude with failover
  chat.ts       conversational intake + location extraction
  rateLimit.ts  fixed-window limiter middleware
```

For multi-instance deployment, replace the `Map` stores in `auth.ts`, `limits.ts`, and `rateLimit.ts` with Redis — the interfaces are already isolated for that swap.
