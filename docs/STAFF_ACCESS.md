# Staff access

How someone who is not the super admin signs in, and what they can see once
they do.

## The short version

Sign in at **`/admin/login`** with an **employee ID and password**. Citizens
use `/login` (phone OTP or Google) and cannot reach the admin door with those
credentials; staff cannot reach the admin portal by signing in at the citizen
door either. The two are separate on purpose.

Where you land is decided by the **server**, from your role — not by the URL
you visited:

| Role | Lands on | Sees |
|---|---|---|
| `super_admin` | `/portal/admin` | everything, nationwide |
| `auditor` | `/portal/admin` | everything, nationwide, **read-only** |
| `state_admin` | `/portal/admin` | one state |
| `district_admin` | `/portal/department` | one district |
| `department_officer` | `/portal/department` | one department |
| `area_officer` | `/portal/officer` | one department **and** district **and** ward |
| `field_officer` | `/portal/officer` | only complaints assigned to them personally |

## The thing that catches everyone

A staff account is **two** environment entries that have to agree:

```
STAFF_DIRECTORY    grants the role, department, district and ward
ADMIN_CREDENTIALS  holds the employee ID and the password hash
```

They are joined **only** by `subject`. When they disagree, nothing errors.
The password is accepted, a session is minted, the browser is redirected — and
the person lands on the *citizen* portal with no role at all, because
authentication succeeded and authorisation found nobody.

That is the correct behaviour. Proving who you are is not the same as being
granted anything, and a login that half-worked would be far worse. But from
the outside it is indistinguishable from "the admin portal is broken", and
there is no log line that says otherwise.

So do not hand-write these two blobs. Use:

```bash
npm run staff:new
```

It asks for the role, name and scope once, derives the `subject` from the
employee ID, and prints **both** entries. They cannot drift, because they were
never typed twice.

To change a password for someone already in the directory:

```bash
npm run staff:password -- EMP-2012 emp-2012@staff.civicai.local
```

Both scripts read the password from the terminal with echo disabled, and
refuse to run without a tty. Neither writes anything to disk, and neither
accepts a password as a command-line argument — arguments are visible in
`ps`, land in shell history, and get captured by process accounting.

## Adding the entries

Both variables are **server-side**. Never prefix either with `VITE_`: that
compiles them into the browser bundle, and in `ADMIN_CREDENTIALS`' case hands
every visitor a set of password hashes to attack offline at their leisure.

Both are JSON **arrays**. Append to the existing value; do not replace it with
a single object.

```bash
vercel env add STAFF_DIRECTORY production --sensitive < STAFF_DIRECTORY.json
vercel env add ADMIN_CREDENTIALS production --sensitive < ADMIN_CREDENTIALS.json
```

Environment changes only take effect on a **new deployment**. Redeploy after
adding them, or the login will keep failing against the old values:

```bash
vercel redeploy https://<your-domain>
```

## Scope strings are compared literally

`rbac.inScope` compares `state`, `district`, `department` and `ward` as plain
strings. `"Water Dept"` in the directory against `"Water"` in the complaint
records is an officer who signs in perfectly and then stares at an empty queue
forever.

Before provisioning, read the values back out of the data rather than guessing
them — sign in as the auditor and look at what the complaints actually say.
This is the single most common reason a correctly-configured account appears
to do nothing.

## Scope you do not need is not just ignored — it narrows you

`scopeFor()` keeps only the dimensions a role observes, because every field
that survives becomes a filter. Give a `state_admin` a `ward` and, without
that narrowing, they would be silently confined to one ward of their state
while every page still looked normal.

This is why `npm run staff:new` asks for a ward only when provisioning an
`area_officer`. Offering the field to everyone invites someone to fill it in.

## Where a role can come from

Resolved in this order, first match wins (`server/staff.ts`):

1. **break-glass** — `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PHONE`. First
   deliberately, so a broken database can never lock the operator out of
   their own portal.
2. **database** — `users ⋈ roles ⋈ officers`. The real answer in production.
3. **`STAFF_DIRECTORY`** — for a deployment with real staff but no database
   yet. Reported as `grantSource: "env"` on `/api/me`.
4. **demo seed** — built-in accounts, **only** outside production and **only**
   with demo mode on.

Anything not found by step 4 is a citizen. A malformed `STAFF_DIRECTORY` and a
database that cannot answer both yield *no* grant rather than an unrestricted
one: configuration that cannot be read must never be read as "no constraints".

## Demo accounts

Outside production, with demo mode on, `EMP-0001` … `EMP-0009` cover all nine
roles. The password is `ADMIN_DEMO_PASSWORD`, or `civicai-demo` if unset.

They are gated on production **and** demo mode — two guards, not one, because
a demo login that survives into production is a backdoor with documentation.

## Rate limiting

`/api/auth/admin-login` allows **10 attempts per 15 minutes per IP**, plus a
per-employee-ID lockout after repeated failures. Several people trying the
portal from the same office wifi or conference network share that budget, and
will start seeing `429 rate_limited` — the correct response, but a surprising
one if you did not expect it during a live demo.

## Verifying a new account actually works

Logging in is not the check. This is:

```bash
curl -s -c ck.txt -X POST https://<domain>/api/auth/admin-login \
  -H 'Content-Type: application/json' \
  -d '{"employeeId":"EMP-2012","password":"..."}'

curl -s -b ck.txt https://<domain>/api/me
```

`/api/me` must report the expected `role`, the full `scope`, and a
`grantSource`. If it comes back with no role, the two entries disagree on
`subject` — see the top of this file.

Then confirm the scope is doing something, by checking that the complaint
count is *smaller* than the auditor's:

```bash
curl -s -b ck.txt 'https://<domain>/api/admin/complaints?limit=200' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["total"])'
```

`tests/staff-provisioning.test.ts` pins the same contract locally, in both
directions: a matched pair resolves to the full scope, and a drifted one
grants nothing rather than something partial.
