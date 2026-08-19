# FAQ

Questions a reviewer actually asks, answered without hedging.

### Is any of this real, or is it all mocked?

Both, and the system tells you which. Complaints, roles, jurisdiction
scoping, the workflow, the audit log, the database, sessions, rate limiting
and document comparison are **real**. The AI, OCR, SMS, email, WhatsApp and
DigiLocker **providers** are real when credentials exist and simulated when
they do not — and every simulated one is labelled Demo everywhere it appears.

`GET /api/health` reports the truth for a running deployment.

### Why not just show everything as working for the demo?

Because the first time a judge asks to see a WhatsApp message actually
arrive, a green "Connected" badge over code that has never called Meta
destroys the credibility of every other claim in the project. The
integration status layer (`server/config.ts`) exists so that cannot happen:
only the presence of real credentials can produce `live`.

### Can a user make themselves an admin?

No. Role comes from the session's subject hash — a SHA-256 of the verified
email or phone, minted server-side. There is no header, query parameter or
body field that changes the answer. The `x-demo-role` header that once
existed has been deleted from both ends; it was gated to non-production, but
its existence meant every reading of the auth code had to carry an "except
in development" caveat.

Try it: sign in as a citizen and request `/api/admin/complaints`. 403.

### What stops an officer reading another district's complaints?

`authorize()` requires **capability and scope**, checked server-side on
every request. An out-of-scope read returns **404, not 403** — a 403 would
confirm the record exists and let someone enumerate complaints outside their
jurisdiction.

`tests/rbac.test.ts` asserts each of these as an attack.

### Where are the uploaded identity documents stored?

Nowhere. Not the bytes, not the extracted fields, not the report. A
30-minute in-memory session, then gone.

That is a decision, not an omission — the reasoning is written at length in
`server/documents.ts`. What passes through that endpoint is somebody's
identity number, date of birth, parents' names and home address, uploaded at
a moment when they have not applied for anything and may never apply.

### Why won't it tell me which document has the right date of birth?

Because it does not know, and pretending otherwise causes real harm in both
directions: telling someone their date of birth is wrong when it is not, or
waving through a genuine error.

What it does instead is more useful. It says the day and month are swapped,
quotes both values, and — if a third document spells the month out — points
out that this settles which convention was used. That turns a frightening
finding into a two-minute fix without anyone guessing.

### Is the AI making decisions about people?

No. The model **describes**; code **decides**. Name matching, date matching,
severity, workflow legality, jurisdiction and duplicate scoring are all
deterministic functions in `matching.ts`, `verify.ts`, `workflow.ts`,
`rbac.ts` and `duplicates.ts` — readable, testable, and covered by tests.

The model's prompts are collected in [PROMPTS.md](PROMPTS.md), including the
rules they are forbidden to break.

### What happens when the AI is down?

Everything keeps working. Every call has a deterministic fallback tagged
`degraded: true`, and the UI says so. Specifically, WhatsApp files the
complaint anyway after three turns — because `readyToFile` is model-supplied
and a permanently-false value would otherwise mean a citizen describes their
problem five times while nothing is recorded.

### Is SMS free?

No. There is no free SMS. Every message costs the department money, the UI
says so on the settings screen, and SMS is off by default like every other
outbound channel.

### Why is WhatsApp marked "configuration required" if the code is written?

Because it has never been tested against a live Meta business account. The
Cloud API integration is complete — signatures, the 24-hour freeform window,
templates, replay protection, STOP — but "implemented" and "verified" are
different claims and this project does not blur them.

### Why does DigiLocker return 501 in live mode?

The OAuth flow is real and works. The issued-documents response parser has
never received a real partner response, and writing one against a guessed
shape produces something that looks finished and fails on contact. It refuses
with an explanation instead.

### Can this handle real traffic?

Not yet, and the reason is specific: several stores are in process memory
(OTP, session revocation, verification sessions, DigiLocker authorisations,
notification preferences, WhatsApp conversations). They do not survive a
restart or span serverless instances. Complaints themselves are in Postgres
and are safe. Redis fixes all six; it is the top item on the roadmap.

### Is it accessible?

Substantially. Contrast ratios are measured and documented beside each token
(the brand orange failed AA on white, so the accessible variant is the token
and the bright one is decoration only). Colour is never the sole carrier of
meaning. Reduced motion is respected everywhere, and animated backgrounds
are opt-in per device. Focus is always visible; touch targets are ≥44px.

Not yet done: a full keyboard-only pass over the officer drawer, and a
screen-reader pass over the verification report.

### Why twelve languages?

Because a grievance portal that only works in English excludes the people
who most need it. Each language appears in the picker in **its own script** —
someone who cannot read the interface still has to find their language in
it. Urdu is right-to-left, which is why the whole layout flips rather than
just the words.

### How long would this take to make production-ready?

The roadmap's first five items — Redis, the media ownership check,
`strictNullChecks`, the citizen UI adopting the 14-state model, and RLS
tests — are the difference between "demonstrable" and "deployable". They are
correctness work, not new features, and they are listed in
[TASKS.md](TASKS.md) with the symptom each one fixes.
