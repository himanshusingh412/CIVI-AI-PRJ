# Outstanding tasks

Ordered by consequence if left undone.

## Correctness

- [ ] Back ephemeral state with Redis — OTP, session revocation, document
      sessions, DigiLocker authorisations, notification preferences,
      WhatsApp conversations. *Symptom today: state vanishes on restart and
      does not span serverless instances.*
- [ ] Ownership check on `GET /api/media/:id`. *Any complaint photo is
      readable by anyone holding the UUID.*
- [ ] Automated coverage for `db/002_rls.sql`. *Policies are verified only by
      reading them.*
- [ ] Enable `strictNullChecks` and remove the `reason?: undefined`
      workarounds.

## Completeness

- [ ] DigiLocker issued-documents parser, against a real partner response.
      *Returns 501 rather than guessing.*
- [ ] Verify WhatsApp against a live Meta business account; register message
      templates for the five events that declare one.
- [ ] Decide and implement WhatsApp attachment handling, or state permanently
      that it is out of scope.
- [ ] Translate the remaining ten locales for the landing page and the newer
      screens. English and Hindi are complete; the rest fall back key by key.
- [ ] Admin portal is English-only by design — confirm that decision or
      reverse it.

## Performance

- [ ] Move `charts` out of the citizen dashboard's initial load (86 kB gzip).
- [ ] Audit the citizen dashboard for renders driven by the SSE stream.

## Verification

- [ ] Browser-based regression tests. Screens are currently verified by
      screenshot at 1440/1280/390px in both themes, but nothing catches a
      regression automatically.
- [ ] Load-test the rate limits rather than reading them.
- [ ] Full keyboard-only pass over the officer drawer and the wizard.
- [ ] Screen-reader pass on the verification report — the most
      information-dense screen in the product.

## Operational

- [ ] Structured logging with request ids.
- [ ] Error reporting (Sentry or equivalent) with PII scrubbing.
- [ ] Uptime monitoring on `/api/health`, alerting when an integration mode
      changes unexpectedly.
- [ ] A documented backup and restore drill for Postgres.

## Done in this build

- [x] Public landing page
- [x] Role-based routing decided server-side
- [x] Real staff accounts; `x-demo-role` deleted from both ends
- [x] Dedicated assistant route with voice
- [x] AI Document Verification: OCR, normalisation, fuzzy matching, report
- [x] DigiLocker simulator walking the real OAuth shape
- [x] Guided complaint wizard with pre-submission review
- [x] Officer queue with live SLA countdowns
- [x] Internal vs public notes
- [x] Unified notification service with four adapters
- [x] WhatsApp intake with signatures, replay protection and consent
- [x] Integration status layer with four honest modes
- [x] 88 automated tests
- [x] Documentation set
