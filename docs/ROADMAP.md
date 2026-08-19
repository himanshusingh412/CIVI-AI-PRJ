# Roadmap

## Next — correctness before features

Everything here fixes something already known to be wrong.

1. **Redis for ephemeral state.** OTP codes, session revocation, document
   verification sessions, DigiLocker authorisations, notification
   preferences and WhatsApp conversation state are all in process memory.
   They vanish on restart and do not span serverless instances. One change
   fixes six symptoms.
2. **Ownership check on media.** `GET /api/media/:id` serves any complaint
   photo to anyone with the UUID. Unguessable is obscurity, not
   authorisation.
3. **Turn on `strictNullChecks`.** Would let ~six `reason?: undefined`
   workarounds be deleted and catch the class of bug they exist to work
   around.
4. **The citizen UI should adopt the 14-state model.** It currently collapses
   to four buckets, losing the distinction between "an officer is assigned"
   and "someone is actually on site" — which is most of what a citizen wants
   to know. The seam is `src/services/complaintAdapter.ts`.
5. **Automated tests for the RLS policies.** `db/002_rls.sql` is currently
   verified only by reading it.

## Then — completing what is started

6. **DigiLocker live mode.** The authorisation flow works; the
   issued-documents parser needs a real partner response before it can be
   written honestly. Currently returns 501.
7. **WhatsApp against a real Meta account**, plus approved message templates
   for the five notification events that have one.
8. **WhatsApp attachments.** Needs a design for fetching attacker-supplied
   files from an unauthenticated webhook — scanning, size limits, quarantine.
9. **Officer mobile.** The queue works on a phone but was designed on a
   desktop. Officers work in the field.
10. **Split the `charts` bundle out of the citizen dashboard.** 86 kB gzipped
    reaching every citizen for a view most never open.

## Later — new capability

11. **Real-time translation of officer notes**, so a citizen reads updates in
    the language they filed in.
12. **Photo-based triage.** Classify severity from an image — pothole depth,
    standing water — to sharpen priority beyond the citizen's own estimate.
13. **Recurrence detection.** The same street reporting the same category
    monthly is a maintenance failure, not five complaints.
14. **Public accountability dashboard.** Resolution rates by department and
    district, published. The single highest-leverage feature here, and the
    one that needs political agreement rather than code.
15. **Offline filing.** A service worker queueing complaints written without
    connectivity.

## Explicitly not planned

| Not planned | Why |
|---|---|
| Automated approval of applications | Not a decision software should make |
| Editing citizen documents | Never, under any circumstance |
| Identity verification against a registry | Requires an authority this does not have |
| Automatic merging of duplicates | Breaks the one promise: your complaint exists |
| Deciding which of two conflicting values is correct | The system genuinely cannot know |
