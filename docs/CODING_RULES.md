# Coding rules

Conventions this codebase actually follows. Written after the fact from what
is there, not aspirationally.

## Comments explain *why*, never *what*

```ts
// BAD — restates the code
// Loop over the complaints and filter by district

// GOOD — records a decision and its consequence
// Out-of-scope reads return 404, not 403 — a 403 would confirm the record
// exists, letting someone enumerate complaints outside their jurisdiction.
```

Every non-obvious decision in this codebase carries the reason it was made
and, where relevant, **what went wrong before**. A comment that says "this
used to be X, which broke because Y" is worth ten that describe syntax.

## Fail closed

A missing scope, an unrecognised role, an unparseable identifier, a database
that will not answer — every one of these denies. There is no path where
absence of information becomes absence of constraint.

```ts
// A field officer with no officerId is denied, not granted.
if (!scope.officerId) return false;
```

## The server is the only authority

The client renders; it never decides. Role, route, permitted transitions,
visible rows and integration status all come from the server on every
request. `RequireRole` and `IntegrationBadge` both carry doc comments saying
they are **not** security boundaries.

Corollary: **nothing an attacker can send may change an authorisation
answer.** No headers, no query parameters, no body fields. The `x-demo-role`
header was deleted for this reason even though it was gated to
non-production — its existence meant every reading of the auth code had to
carry an "except in development" caveat.

## Adapters, not conditionals

An external dependency gets an interface and at least two implementations —
the real one and a labelled simulation. Provider selection happens in the
adapter, never at the call site, and never in a component.

## Never claim more than is true

`server/config.ts` is the enforcement point. Only the presence of real
credentials can produce `live`. "Connected" is not used about anything.
A simulated result is tagged `simulated: true` all the way to the UI.

## Bound every in-memory structure

Every `Map` and array that grows from user input has a cap and a sweep. An
unbounded one on a long-running process is a memory leak with a friendly
name.

```ts
const OUTBOX_LIMIT = 100;
const sweep = setInterval(/* … */, 60_000);
sweep.unref?.();   // never keep the process alive
```

## Discriminated unions need explicit `undefined`

`strictNullChecks` is off. Without this, `if (!result.ok)` does not narrow:

```ts
type Result =
  | { ok: true;  value: string; reason?: undefined }
  | { ok: false; reason: string; value?: undefined };
```

Appears in `sms.ts`, `rbac.ts`, `ocr.ts`, `whatsapp.ts`. Each has a comment.

## Never block the citizen's path

A slow SMS gateway must not delay the response that tells someone their
complaint exists. Notifications are fire-and-forget and swallow their own
failures. A failed AI review does not prevent filing. A failed photo upload
is reported separately and never loses the complaint.

## Validate at the boundary, then trust

Enums are re-checked after every model response — a category outside the
list would route to a department that does not exist. Uploads are sniffed by
magic number, never by the declared type. Webhook payloads are parsed
defensively, every field optional in practice.

## Naming

- Server files are lower-case nouns: `staff.ts`, `matching.ts`, `verify.ts`
- Components are `PascalCase.tsx`
- Booleans read as assertions: `isTerminal`, `windowOpen`, `requiresUserAction`
- Verdicts are unions, not booleans: `'match' | 'near_match' | 'review' | 'mismatch' | 'ambiguous_format' | 'missing'`

That last one matters. A boolean `matches` cannot express "these could be
the same date written two ways and I cannot tell" — which is the single most
useful thing this product says.

## Tests encode policy

Named after the thing that must not happen. Several assert on **wording**,
because the wording is the guarantee:

```ts
assert.match(r.reason, /cannot tell which/i);
assert.doesNotMatch(r.reason, /is correct|should be/i);
```

## Before committing

```bash
npm run verify   # lint, test, build
```
