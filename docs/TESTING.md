# Testing

```bash
npm test           # 88 tests, no external services required
npm run lint       # tsc --noEmit
npm run build      # production bundle
npm run verify     # all three
```

Node's built-in test runner via `tsx`. No test framework dependency.

## What is covered

| File | Tests | Subject |
|---|---|---|
| `tests/matching.test.ts` | 25 | Name, date, address and document-number comparison |
| `tests/rbac.test.ts` | 22 | Capability × scope authorisation, workflow transitions |
| `tests/whatsapp.test.ts` | 27 | Webhook signatures, replay, parsing, consent, notification channels |
| `tests/verify.test.ts` | 14 | The document verification report end to end |

## How these tests are written

Each case is written as **the thing that must not happen**, not as the happy
path. `"a field officer cannot reach a colleague's case"` rather than
`"scope filtering works"`. A test named after the attack fails in a way that
tells you what broke.

Several encode **policy, not just behaviour**:

- A day/month swap must never be silently resolved. The test asserts the
  message contains "cannot tell which" and does **not** contain "is correct".
- No recommendation may tell a citizen to alter a document.
- Every notification must carry the complaint reference.
- In-app notifications cannot be switched off, however hard a client tries.
- A document number is never compared across different document types — a
  PAN and an Aadhaar number are *supposed* to differ.

## Bugs these tests caught

Written down because it is the argument for having them:

1. **A day/month swap reported as a match.** Both `12/03/2001` and
   `03/12/2001` produce the same candidate set, so a naive cross-product
   found an overlap and declared them identical — the exact failure the
   feature exists to prevent.
2. **`M.G. Road` not matching `MG Road`**, because punctuation became a
   space and produced a different token count.
3. **STOP's own confirmation blocked** by the opt-out it had just set, so a
   citizen who opted out heard nothing and had no idea it worked.
4. **A WhatsApp user could never file if the AI was down** — `readyToFile`
   is model-supplied and the fallback sets it false forever, so the system
   asked for detail indefinitely while recording nothing.

## What is not covered

- **No browser tests.** The UI has been verified by screenshot at 1440px,
  1280px and 390px, in light and dark, but there is no automated regression.
- **No Postgres integration tests.** The store interface is exercised
  through the in-memory implementation. RLS policies in `db/002_rls.sql` are
  unverified by automation.
- **No load testing.** The rate limits are asserted by reading the code.
- **The live paths of WhatsApp, DigiLocker, Resend and Twilio are untested**
  against real services, by definition — they need credentials.

## Manual verification

The end-to-end flow that must work before a demo is
[DEMO_SCRIPT.md](DEMO_SCRIPT.md). The authorisation checks worth re-running
by hand after any change to `server/rbac.ts`:

```bash
# sign in as each demo account and confirm the visible row count
# 9000000001 super      → all
# 9000000002 state      → Delhi only
# 9000000003 district   → New Delhi only
# 9000000004 department → Delhi Water only
# 9000000005 field      → their own assignments only
# 9000000006 auditor    → all, masked, 403 on any write
```

A field officer requesting a colleague's complaint must get **404, not 403**.
