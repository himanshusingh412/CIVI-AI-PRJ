# Demo script

Roughly seven minutes. Every step works with **no external credentials** —
simulated providers are labelled as such throughout, which is itself part of
what is being demonstrated.

## Before you start

```bash
npm install
npm run dev:full
```

In `.env`:
```
AUTH_DEV_OTP=true
```

That is the only setting the demo needs. With `AI_API_KEY` set as well, the
assistant and OCR are real rather than fixtures.

---

## 1 · The front door (30s)

Open <http://localhost:3000>.

> "This is a public page. You can read the whole thing without an account —
> which matters, because the people who most need this service are the least
> likely to hand over a phone number to something that has not yet told them
> what it does."

Point at **Built to be checked, not trusted**. Every claim there is one the
codebase backs up.

---

## 2 · Sign in as a citizen (30s)

**Continue as citizen** → any 10-digit number, e.g. `9876543210`.

The one-time code appears on screen because `AUTH_DEV_OTP=true`.

> "The code is real — hashed, rate-limited, six attempts then a lockout. Only
> the delivery is simulated. And notice the copy never says whether that
> number has an account: every outcome returns identical text, so this cannot
> be used to find out who is registered."

---

## 3 · The assistant (60s)

**Open the full assistant**.

Type or **dictate**: *"Sector 14 mein teen din se paani nahi aa raha hai"*

> "Hindi in Latin script, and it understands. Twelve languages, and the
> speech recognition runs in the browser — the audio never leaves the device."

Watch the right panel fill in: category, urgency, location, and what is
**still missing**.

> "It is building a structured record while you talk, and showing you that
> record. If it has got the category wrong, you find out now — not when an
> officer does."

Answer the follow-up. When it says it is ready, **do not file yet.**

---

## 4 · Document verification — the centrepiece (2 min)

Right panel → **Check my documents** (or `/portal/documents`).

> "Applications get rejected weeks later because two documents disagree. The
> information needed to prevent that was in the citizen's own hands the whole
> time."

Click **Connect DigiLocker**.

> "Read the banner. This is a simulation and says so in its first sentence —
> there are no MeitY partner credentials here. But the flow is the real one:
> you leave the site, you approve on their domain, you come back with a
> token. CivicAI never sees your DigiLocker password."

**Allow** → tick Aadhaar, PAN and Class X Marksheet → **Import** →
**Check for problems**.

The report appears. Walk through it top down:

- **Date of birth — FIX BEFORE APPLYING.** Aadhaar says `12/03/2001`, PAN
  says `03/12/2001`.

  > "It does not tell you which is right, because it cannot know. That is the
  > single most important line on this screen. Guessing would either tell
  > someone their date of birth is wrong when it is not, or wave through a
  > real error."

- **The green box.** The marksheet spells the month out — `12 March 2001` —
  which has only one reading.

  > "So a third document settles which convention was used. That turns a
  > frightening blocking finding into a two-minute fix. It still stops short
  > of declaring it resolved."

- **Address — WORTH CHECKING.** Different PIN codes.

  > "A warning, not a blocker. People move house. Getting that distinction
  > wrong sends someone to a government office for nothing."

- Expand **2 minor differences most departments accept** — *Rahul Kumar
  Singh* vs *Rahul K. Singh*.

  > "Not a problem, and not hidden either."

Finally, the privacy line at the top:

> "None of this is stored. Not the files, not the extracted fields, not the
> report. Thirty minutes in memory, then gone. Retaining it would mean the
> state holds a copy of your identity documents because you once *considered*
> an application."

---

## 5 · File a complaint (90s)

`/portal/report`.

Category → **Water supply**. Description → dictate it. Location → **Use my
current location** or type a landmark. Urgency → **High**.

> "The urgency options describe consequences, not adjectives. 'High' on its
> own means nothing, and if everything is Critical then nothing is."

Photo → skip. **Continue** → the AI review.

> "It asks for at most three more things, and only things an officer actually
> needs for this category. Notice the line underneath: you can file without
> them. A pre-submission check that can refuse to let you file is a gate, and
> a gate on a grievance system is the problem it exists to solve."

**File this complaint** → the reference appears.

---

## 6 · WhatsApp (45s)

```bash
curl -s -X POST localhost:8787/api/whatsapp/simulate \
  -H 'Content-Type: application/json' \
  -d '{"from":"9876543211","text":"garbage has not been collected on our street for a week"}'
```

Run it two or three times with follow-up detail, then:

```bash
curl -s localhost:8787/api/whatsapp/status | jq .outbox
```

> "That is the real handler, not a mock — the same understanding, the same
> categories, the same store. A WhatsApp complaint is the same object an
> officer sees. And the 24-hour messaging window and the STOP keyword are
> both implemented, because a portal that ignores them gets its number
> blocked the first time it tries to tell a real citizen anything."

Send `STOP` and show that the confirmation arrives and nothing after it does.

---

## 7 · The officer (60s)

Open a private window → **Staff / admin login** → `9000000005` → dev code.

> "Field officer. This is a queue, not a dashboard — no charts. Ordered by
> deadline, not priority: a Critical case with three days left is less urgent
> right now than a Medium one breaching in an hour, and sorting by priority
> is how the second one gets missed."

Open a case → add an internal note with **Staff only** selected → **Save note
only**.

> "Recording work and reporting progress are different acts, so they have
> different buttons. Before this, the only way to leave a record was to
> advance the status — which quietly turned the history into a log of things
> that did not happen."

---

## 8 · Scope, demonstrated (45s)

Sign out. Sign in as `9000000004` (Water department, Delhi).

> "One complaint. Sign in as the district admin and it is two; as the state
> admin, three; as the super admin, five. That filtering is server-side —
> the other rows never left the building."

Then the closing point:

> "Try editing the URL to `/portal/admin` as this officer."

It refuses with a screen that gives nothing away.

> "And that refusal is not what protects it. The screen behind it fetches
> from endpoints that re-check the role and the jurisdiction on every single
> request. Routing is convenience; authorisation is enforcement."

---

## If asked "what is actually real?"

Open `/api/health` or point at the badges. Every integration reports one of
four honest modes derived from what is configured. The README has the table.

**Nothing in this build is labelled Live that has not been wired to a real
provider**, and the two integrations that have credentials but unverified
response parsing return `501` rather than guessing.
