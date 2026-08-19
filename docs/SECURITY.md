# Security

## Threat model

Who this system has to defend against, in rough order of likelihood:

1. **A curious citizen** who edits a URL or a request body to see whether
   they can reach the admin portal or another person's complaint.
2. **A junior officer** who tries to act outside their jurisdiction —
   usually by accident, occasionally not.
3. **An automated scanner** hitting every endpoint with malformed input.
4. **Someone probing the auth surface** for account enumeration, OTP
   brute-force, or a session that can be forged.
5. **A forged webhook**, since the WhatsApp endpoint is the only
   unauthenticated write path in the application.

## Controls

### Authentication
- Sessions are **HMAC-signed stateless tokens**, verified on any instance.
- Sliding expiry (1h) with **rotation on refresh**, bounded by an absolute
  cap (12h) that refresh never extends.
- The token carries a **hash** of the verified identity, never the address.
- `httpOnly` session cookie — unreachable from JavaScript, so an XSS cannot
  exfiltrate it. A separate readable cookie carries the CSRF token
  (double-submit).
- OTP: 6 digits, **hashed at rest**, 5-minute expiry, 6 verify attempts,
  5 sends per 15 minutes, 30-second resend cooldown, 15-minute lockout.
- **Account enumeration is closed**: every terminal outcome of "request a
  code" returns byte-identical copy, including for a filtered bot, and
  auth endpoints are padded to a uniform latency floor with jitter.

### Authorisation
- Capability **and** scope, checked server-side on every request.
- **Out-of-scope reads return 404, not 403.** A 403 confirms the record
  exists and lets someone enumerate complaints outside their jurisdiction.
- Role comes from the session's subject hash **only**. There is no header,
  query parameter or body field that grants a role. The `x-demo-role` header
  that previously existed has been deleted from both ends.
- Field-level redaction: auditors receive masked names and phone numbers and
  no internal notes.
- Read-only roles are rejected **before** workflow validation, so an auditor
  never receives a 422 describing the valid transitions.

### Input
- `express.json` capped at 64 kB; malformed JSON returns a clean 400.
- Uploads are **sniffed by magic number**, not by the client's declared
  Content-Type or filename.
- Filenames are treated as hostile text: control characters and
  bidirectional overrides stripped (U+202E turns "annexure-gpj.exe" into
  something that reads as "annexure-exe.jpg"), path separators flattened.
  Uploaded names never reach a filesystem — nothing is written to disk.
- Category and status values are validated against server-side enums, so a
  model or a client cannot invent one.

### Webhooks
- **HMAC over the raw bytes.** The original buffer is captured by a `verify`
  hook on the JSON parser, because re-serialising a parsed object changes
  key order and therefore the digest.
- The verification handshake compares tokens in **constant time** and rejects
  a prefix.
- **Replay protection** by message id — Meta retries, and without this one
  citizen message becomes three complaints.
- Its own rate limit (600/min) so a busy hour cannot drop real reports.
- Always returns 200: Meta disables subscriptions that appear to fail.

### Rate limiting
| Surface | Budget |
|---|---|
| Global `/api` | 120 / min |
| OTP request | 10 / 15 min per IP, 5 / 15 min per identifier |
| OTP verify | 20 / 15 min |
| Google sign-in | 20 / 15 min |
| AI endpoints | 10 / min per session |
| Chat | 15 / min per session |
| WhatsApp webhook | 600 / min |

Plus a daily AI request budget and a concurrency cap, so a runaway client
cannot exhaust the model quota for everyone.

### Data minimisation
- **Document verification persists nothing.** Not the bytes, not the
  extracted fields, not the report. 30-minute in-memory session, then gone.
  See the storage-policy comment in `server/documents.ts`.
- Assistant transcripts stay in the browser.
- Audit entries record that a note was written and its length, **never its
  body** — notes can contain a citizen's personal circumstances and auditors
  have no business reading them.
- Identity numbers are masked in the UI.
- OTPs, tokens and passwords are never logged.

### Audit
Append-only, hash-chained so tampering is detectable. Records the actor,
action, target, timestamp and IP. **Denied access attempts are audited** —
a failed attempt is exactly what an auditor needs to see.

## Known gaps

Stated because a security document that lists only strengths is marketing.

1. **Session revocation is per-instance.** Logout adds the token id to an
   in-memory list; on multi-instance serverless another instance will not
   know. Exposure is bounded by the 1-hour token life. Redis fixes it.
2. **OTP state is per-instance.** A code issued by one instance may not be
   verifiable by another. Google sign-in is unaffected.
3. **Media is served without an ownership check.** Ids are unguessable
   UUIDs, which is obscurity, not authorisation. Flagged in
   `server/media.ts`.
4. **No malware scanning on uploads.** Files are type-checked and size-capped
   but never scanned. They are also never executed, never written to disk,
   and served with `X-Content-Type-Options: nosniff` and a forced filename.
5. **`SESSION_SECRET` missing in production degrades rather than refuses.**
   Throwing at module load on Vercel kills the entire import chain and every
   route returns a bare 502 with nothing in the logs. It logs loudly, uses an
   ephemeral secret, and surfaces the misconfiguration at `/api/health`.
6. **DigiLocker live mode is unfinished** and returns 501 rather than
   guessing a response shape.

## If a credential leaks

Deleting the file is not enough — assume it is compromised from the moment
it was committed.

1. **Rotate at the provider first**, before touching the repository.
2. Then remove it from history (`git filter-repo`), force-push, and tell
   everyone with a clone.
3. Rotating `SESSION_SECRET` signs everybody out. That is the correct
   outcome if it leaked.

`.gitignore` excludes `.env*` except `.env.example`. Git history has been
scanned and contains no secrets.
