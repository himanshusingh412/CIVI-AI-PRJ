# Prompts

Every prompt this system sends to a model, and the rule each one enforces.
They are collected here because a prompt is not a string — it is where the
product's judgement lives, and it should be reviewable without reading four
source files.

## 1 · Complaint understanding — `server/chat.ts`

Powers both the web assistant and WhatsApp intake, so the two channels agree
about what a complaint is.

**Rules it enforces**
- Category must be one of the server's enum. Re-validated after the response
  regardless — a category outside the list would route to a department that
  does not exist.
- `readyToFile` only when there is **both** a clear problem **and** a place.
- Reply in the language the citizen used.
- Two short sentences maximum.
- Never invent facts.

## 2 · Pre-submission review — `server/complaints.ts`

**Rules**
- Ask only for information an officer needs **for this category**. A pothole
  needs a landmark and whether traffic is affected; a power cut does not.
- Never ask for something the draft already contains.
- **At most three questions.** Someone reporting a burst water main should
  not face a form.
- The summary is written for the officer, third person, no added urgency.
- Never invent departments, form numbers, fees or timelines.

Advisory by construction: nothing it returns can block submission.

## 3 · Document transcription — `server/ocr.ts`

The strictest prompt in the system, because its failure mode is the worst.

**Rules**
- *"You are a TRANSCRIBER, not an interpreter."*
- Copy values **exactly as printed, including the original date format**. If
  the document prints `12/03/2001`, return `12/03/2001` — never reformat,
  never decide whether 12 is the day or the month.
- **Return `null` for anything absent, illegible or uncertain. Never guess.**
- Do not correct spelling, expand abbreviations, or normalise anything —
  downstream code does that and needs the original.
- Return the name exactly as printed on **this** document, even if it looks
  misspelled.
- `confidence` is an honest self-assessment.

**Temperature 0.** Extraction is transcription; any temperature above zero
is the model being invited to improvise a date it could not quite read.

Post-processing rejects the strings `"null"`, `"N/A"`, `"none"`, `"-"` and
friends, because a model that emits `"N/A"` for two documents would have
those compare as a perfect match on a field neither document carries.

**Why this matters:** a hallucinated date of birth would be compared, scored,
and reported to a citizen as a discrepancy in their own documents.

## 4 · Discrepancy explanation — `server/verify.ts`

**Rules**
- **NEVER state which document is correct. You do not know.**
- **NEVER tell the citizen to alter, edit or fabricate a document.**
- Never promise an application will be accepted or rejected.
- Do not invent procedures, offices, form numbers, fees or timelines. If the
  exact process is unknown, say to ask at the issuing office.
- Write for someone who is not a lawyer. Short sentences.
- Be calm and practical. This person is trying to get something done.

A test asserts no recommendation ever matches `/edit|alter|forge|amend it
yourself/`.

## What is deterministic, not prompted

Deliberately **not** model decisions:

| Decision | Where |
|---|---|
| Whether two names match | `server/matching.ts` |
| Whether two dates match | `server/matching.ts` |
| Whether a difference is critical | `server/verify.ts` field policy |
| Which transitions are legal | `server/workflow.ts` |
| Who may see what | `server/rbac.ts` |
| Whether a complaint is a duplicate | `server/duplicates.ts` |

The model **describes**; it does not decide. Every consequential judgement is
code you can read, test and argue with — and all of them are covered by
`tests/matching.test.ts` and `tests/verify.test.ts`.

## Failure behaviour

Every call has a deterministic fallback and the response is tagged
`degraded: true`. The UI says so. Specifically:

- Assistant → a canned prompt for the missing information
- Review → server-side checks only (is there a location? a description long
  enough? a photo?), never an invented question
- OCR → fixtures, marked `simulated`
- Explanation → a factual summary built from the findings

**No fallback ever fabricates a finding**, and none of them blocks the
citizen. WhatsApp specifically files the complaint anyway after three turns,
because `readyToFile` is model-supplied and a permanently-false value would
otherwise mean a citizen describes their problem five times and nothing is
ever recorded.
