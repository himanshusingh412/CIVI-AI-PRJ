# Presentation content

Slide-by-slide. Speaker notes in italics.

---

## 1 · Title

**CivicAI**
Your digital gateway to government services

*One line, said out loud: "Two things break government services, and both
are fixable with information the citizen already has."*

---

## 2 · The problem

**A complaint disappears.**
No reference. No named officer. No deadline. No way to find out.

**An application is rejected weeks later.**
Because two of your own documents spell your name differently, or write your
date of birth the other way round.

*The second one is the sharper story. Fee paid, day off taken, told by post,
start again — and the discrepancy was in their hands the whole time.*

---

## 3 · What we built

| | |
|---|---|
| **Report** | Form, conversation or WhatsApp. Twelve languages. Voice. |
| **Verify** | Cross-check your documents **before** you apply. |
| **Track** | Named officer, deadline, timeline, every status change. |
| **Resolve** | A case cannot be closed without you. |

---

## 4 · Document verification — the centrepiece

> Aadhaar: **12/03/2001**
> PAN: **03/12/2001**

**"The day and month are swapped. That can mean the same date written two
ways, or two different dates. CivicAI cannot tell which."**

> Class X Marksheet: **12 March 2001**
> → a spelled-out month has only one reading, so this settles the convention.

*The refusal to guess is the feature. Guessing would either tell someone
their date of birth is wrong when it isn't, or wave through a real error.
And the third document turning a blocker into a two-minute fix is the moment
the room understands what this is for.*

---

## 5 · How it decides

```
OCR  ──▶  normalise  ──▶  compare  ──▶  severity  ──▶  explain
         case, titles,    Jaro-Winkler   critical /     plain language,
         diacritics,      + token        warning /      never "you should"
         abbreviations,   alignment      info
         date formats
```

**The model describes. Code decides.**
Name matching, date matching and severity are deterministic functions with
39 tests over them.

---

## 6 · Authorisation

**Capability × Scope**, checked server-side on every request.

| Role | Sees |
|---|---|
| Field officer | Only their own assignments |
| Department officer | Their department, their state |
| District admin | Their district |
| State admin | Their state |
| Super admin | Everything |
| Auditor | Everything, read-only, **contact details masked** |

*Out-of-scope reads return 404, not 403 — a 403 confirms the record exists.
Demonstrate by signing in as two roles and counting the rows.*

---

## 7 · Honest by construction

Every integration reports one of four modes, derived from what is actually
configured:

**✅ Live · 🔵 Demo · 🟡 Configuration required · ⚪ Off**

*"Nothing in this build is labelled Live that hasn't been wired to a real
provider. The DigiLocker consent screen says in its first sentence that it
is not DigiLocker. Two integrations have credentials but unverified response
parsing, and they return 501 rather than guessing."*

*This slide is the trust argument. Do not skip it.*

---

## 8 · Privacy

**Uploaded documents are never stored.**
Not the files. Not the extracted fields. Not the report.
30 minutes in memory, then gone.

**Assistant conversations stay in your browser.**

**Audit logs record that a note was written — never its contents.**

*"Retaining verification data would mean the state holds a copy of your
identity documents because you once considered an application."*

---

## 9 · Reaching everyone

- **Twelve languages**, each shown in its own script. Urdu flips the layout.
- **Voice**, running in the browser — the audio never leaves the device.
- **WhatsApp**, because a large share of users will never install an app.
- **Animated backgrounds are opt-in per device** — rejected on reduced
  motion, small screens, Save-Data, 2g/3g, under 4 cores or 4 GB.

*Each of those rejections is a real population, not a hypothetical.*

---

## 10 · Built to be checked

- 88 automated tests, no external services required
- Tamper-evident audit log, hash-chained
- 14-state workflow where illegal transitions are impossible by construction
- Every claim in the README has a file you can open

*Four real bugs were caught by these tests, including a day/month swap being
reported as a match — the exact failure the feature exists to prevent.*

---

## 11 · What is not done

- Six stores are in process memory. Redis is one change that fixes all six.
- DigiLocker live mode is unfinished past authorisation.
- WhatsApp is untested against a real Meta account.
- No browser regression tests.

*Say this slide out loud. A prototype that lists its gaps is more credible
than one that does not have them.*

---

## 12 · Close

**The system routes, tracks, compares and reports.**
**Every judgement about a person belongs to a person.**

Which date is right. Whether these are the same human. Whether to approve.
CivicAI hands those over — deliberately, and by design.
