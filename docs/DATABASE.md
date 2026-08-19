# Database

PostgreSQL 14+. Portable — runs unchanged on Neon, Supabase or plain PG.
`db/001_schema.sql` is provider-neutral; `db/002_rls.sql` holds the
Supabase-specific row-level security policies.

Applied automatically on first boot when `DATABASE_URL` is reachable.

## Conventions

Every domain table carries:

| Column | Purpose |
|---|---|
| `id` | UUID primary key, `gen_random_uuid()` |
| `created_at` / `updated_at` | `timestamptz`; `updated_at` maintained by trigger |
| `deleted_at` | Soft delete. **All reads filter it out.** |
| `created_by` / `updated_by` | FK to `users`, nullable for system rows |

**Soft delete conflicts with UNIQUE.** A deleted row would still occupy its
unique slot, so every unique index here is **partial**
(`WHERE deleted_at IS NULL`) — an address can be reused after the old
account is removed.

## Tables

| Table | Holds |
|---|---|
| `roles` | Role names with a JSONB permission list, so roles are editable without a migration |
| `departments` | Name, code, default SLA hours |
| `users` | Citizens and staff. `CHECK (email IS NOT NULL OR phone IS NOT NULL)` — a user must be reachable, or notifications are impossible |
| `officers` | Assignment, jurisdiction, and a denormalised `current_workload` |
| `complaints` | The core record |
| `complaint_media` | Attachment metadata **and bytes** (`content BYTEA`) |
| `complaint_status_history` | Every transition, with separate public and internal notes |
| `notifications` | Delivery records |
| `ai_analysis` | Classification, confidence, spam and duplicate scores |
| `audit_logs` | Append-only, hash-chained |
| `citizen_feedback` | One rating per complaint |
| `announcements` | Jurisdiction-scoped notices |
| `chatbot_history` | Present and **not written to** — see below |
| `emergency_alerts` | Geofenced alerts |

## Indexes worth knowing

```sql
-- Mirrors the RBAC scope predicate exactly. Every admin list query filters
-- on some prefix of this.
idx_complaints_scope (state, district, department_id, assigned_officer_id)

-- Only open rows can breach, so indexing closed ones wastes space and slows
-- every write.
idx_complaints_open_sla (sla_deadline)
  WHERE status NOT IN ('closed','rejected_spam','merged')

-- The bell badge only ever counts unread rows.
idx_notifications_unread (user_id, created_at DESC) WHERE is_read = FALSE

-- Full-text over title + description.
idx_complaints_fts GIN (to_tsvector('english', title || ' ' || description))
```

## Constraints that enforce policy

```sql
-- A closed complaint must record when. In the schema, not in app code, so
-- no code path can produce a half-closed row.
CHECK (status <> 'closed' OR closed_date IS NOT NULL)

-- A complaint cannot be its own duplicate.
CHECK (duplicate_of_id IS NULL OR duplicate_of_id <> id)
```

## `complaints_api`

The application reads through a **view**, not the base table.

There were once two competing `complaints` tables — a normalised one across
14 tables, and a denormalised one with JSONB sub-documents — both declared
`CREATE TABLE IF NOT EXISTS`. Whichever ran first won and the other silently
did nothing, which is how a partial index on `deleted_at` ended up failing
against a table with no such column.

`complaints_api` is the reconciliation: normalised tables stay the single
source of truth, and the flat shape the app expects is **derived** rather
than duplicated as a second physical table.

## Triggers

- `set_updated_at` on every table with an `updated_at`.
- `sync_officer_workload` keeps `officers.current_workload` accurate without
  a `COUNT(*)` on every dashboard render — which would dominate the query
  plan past a few hundred thousand complaints.

## What is deliberately NOT stored

**Document verification writes nothing.** Not the uploaded bytes, not the
extracted fields, not the report. A 30-minute in-memory session, then gone.

That is a decision, not an omission. What passes through that endpoint is a
citizen's identity number, date of birth, parents' names and home address,
uploaded at a moment when they have not applied for anything and may never
apply. Retaining it would mean the state holds a copy of someone's identity
documents because they once *considered* an application.

**`chatbot_history` exists and is not written to.** Assistant transcripts
stay in the browser. Moving them server-side is a policy decision needing a
privacy notice, a retention period, a deletion path and a lawful basis — not
a storage detail to add quietly because a table is convenient.

## Seeding

```bash
npm run db:seed        # ~500 citizens, ~100 officers, ~1000 complaints
npm run db:seed:dry    # show what it would do
npm run db:reset       # truncate, then seed
```

Volumes are chosen so RBAC scoping is **observable** — with one row per
jurisdiction you cannot tell filtering from luck.

## Migration path

Attachment bytes live in Postgres. That is a deliberate trade at this stage:
no extra vendor, no bucket policy, and it inherits the backups and access
control the database already has. It does **not** scale past a few GB, and
rows this large bloat the WAL.

`complaint_media.storage_key` exists so the move to object storage is a
backfill, not a schema change.
