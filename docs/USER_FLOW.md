# User flows

## Citizen — filing and following

```
Landing page (public, no account)
   │
   ├─▶ Continue as citizen ─▶ phone ─▶ OTP ─▶ /portal
   │
   └─▶ Staff / admin login ─▶ /staff

/portal
   ├─▶ /portal/report      guided form
   ├─▶ /portal/assistant   conversation + voice
   ├─▶ /portal/documents   verification
   └─▶ /portal/settings    notification preferences
```

### The guided form

```
Category ─▶ Description ─▶ Location ─▶ Urgency ─▶ Evidence ─▶ AI review ─▶ Filed
   │            │              │                                  │
   │            └─ dictate     ├─ GPS                             ├─ asks ≤3 questions
   │                          ├─ typed landmark                   ├─ never blocks
   │                          └─ map pin                          └─ every row editable
   └─ decides the department
```

Ends with a reference number, an expected response time, and a duplicate
notice if one was found — with the complaint **still registered separately**.

### The conversation

```
"Sector 14 mein paani nahi aa raha"
   │
   ├─▶ extracts category, urgency, location
   ├─▶ names what is still missing
   └─▶ offers to file once it has the problem AND the place
```

The right-hand panel shows what has been understood **while** the
conversation happens, so a wrong category is caught by the person who knows.

### Document verification

```
Upload  or  Connect DigiLocker
   │             │
   │             ├─▶ consent screen (labelled if simulated)
   │             └─▶ choose which documents to share
   ▼
OCR / issued data
   ▼
normalise ─▶ compare pairwise ─▶ severity ─▶ report
                                              ├─ critical: fix before applying
                                              ├─ warning:  worth checking
                                              ├─ info:     most departments accept
                                              └─ corroboration from a third document
```

Nothing is stored. Nothing is edited. Nothing is decided.

## Complaint lifecycle

```
submitted
   ▼
ai_verification
   ▼
department_assigned ──▶ officer_assigned ──▶ investigation_started
                                                   │
                          ┌────────────────────────┼──────────────┐
                          ▼                        ▼              ▼
                field_visit_scheduled     work_in_progress   evidence_uploaded
                          └────────────────────────┼──────────────┘
                                                   ▼
                                               resolved
                                                   ▼
                                        citizen_verification
                                          ├─▶ closed
                                          └─▶ reopened ─▶ back to work

exceptions: rejected_spam (admin only) · merged
```

**Closure is unreachable without citizen verification.** An officer cannot
unilaterally declare a case finished, and `closed` is not terminal — a
citizen can always reopen.

## Officer

```
/staff ─▶ OTP ─▶ /portal/officer

Queue ordered by DEADLINE, not priority
   ├─ Overdue · Due in 24h · Open · Resolved
   └─ open a case
        ├─ citizen evidence
        ├─ internal notes (staff only by default)
        ├─ "Save note only"  ← recording work
        └─ transitions        ← reporting progress
```

Only cases inside the officer's scope are ever returned. Those two buttons
are separate because before they were, the only way to leave a record was to
advance the status — which turned the history into a log of things that did
not happen.

## Administrator

```
/portal/department        queue + overview tabs
/portal/admin             analytics + audit log
```

Both scoped server-side. A district admin's district appears because the
other districts' rows never left the server.

## WhatsApp

```
Citizen ─▶ WhatsApp ─▶ Meta Cloud API ─▶ webhook
                                            ├─ verify signature
                                            ├─ suppress replays
                                            ├─ honour STOP first
                                            └─ same handleChat as the web
                                                    ▼
                                              complaint created
                                                    ▼
                                        one confirmation with the reference
```

`STATUS <ref>` checks a complaint. `STOP` opts out and is confirmed. Anything
else starts a new complaint, and the confirmation says so.
