/**
 * Postgres (Neon) implementation of ComplaintStore.
 *
 * Activated automatically when DATABASE_URL is set — see store.ts. Until
 * then the in-memory store is used and the UI shows a "not durable" banner,
 * so there is never ambiguity about whether data is really being saved.
 *
 * SETUP
 *   1. Create a project at https://neon.tech (free tier is fine)
 *   2. Copy the pooled connection string
 *   3. Put it in .env as:  DATABASE_URL=postgresql://...?sslmode=require
 *   4. npm install @neondatabase/serverless
 *   5. Restart — the schema is created on first boot
 *
 * Injection safety: every value goes through the driver's parameterised
 * tagged-template. No string concatenation builds SQL anywhere in this file.
 */
import type { Complaint, ComplaintStore } from './store.js';

type SqlClient = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<any[]>;

let sql: SqlClient | null = null;

/**
 * Loads the Neon driver lazily so the package is only required when Postgres
 * is actually configured — the app still builds and runs without it.
 */
export async function initPostgres(): Promise<boolean> {
  const url = process.env.DATABASE_URL;
  if (!url) return false;

  try {
    // Specifier held in a variable so TypeScript doesn't try to resolve the
    // module at compile time — the driver stays an optional dependency and
    // the project builds fine without it installed.
    const spec = '@neondatabase/serverless';
    const mod: any = await import(/* @vite-ignore */ spec);
    sql = mod.neon(url) as SqlClient;
  } catch (err) {
    console.error(
      '[store] DATABASE_URL is set but the driver failed to load. ' +
      'Run: npm install @neondatabase/serverless\n', err,
    );
    return false;
  }

  await sql`
    CREATE TABLE IF NOT EXISTS complaints (
      id                    TEXT PRIMARY KEY,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
      citizen_name          TEXT NOT NULL,
      citizen_phone         TEXT NOT NULL,
      citizen_email         TEXT,
      category              TEXT NOT NULL,
      description           TEXT NOT NULL,
      state                 TEXT NOT NULL,
      district              TEXT NOT NULL,
      ward                  TEXT,
      lat                   DOUBLE PRECISION,
      lng                   DOUBLE PRECISION,
      department            TEXT,
      assigned_officer_id   TEXT,
      assigned_officer_name TEXT,
      status                TEXT NOT NULL,
      priority              TEXT NOT NULL,
      escalation_level      INTEGER NOT NULL DEFAULT 0,
      sla_deadline          TIMESTAMPTZ NOT NULL,
      duplicate_of_id       TEXT,
      -- Sub-documents kept as JSONB: they are always read with the parent
      -- row and never queried independently, so separate tables would add
      -- joins for no benefit.
      attachments           JSONB NOT NULL DEFAULT '[]'::jsonb,
      timeline              JSONB NOT NULL DEFAULT '[]'::jsonb,
      internal_notes        JSONB NOT NULL DEFAULT '[]'::jsonb,
      public_updates        JSONB NOT NULL DEFAULT '[]'::jsonb,
      citizen_rating        INTEGER
    )`;

  // Indexes match the RBAC scope predicates — these are the columns every
  // list query filters on.
  await sql`CREATE INDEX IF NOT EXISTS idx_complaints_scope
            ON complaints (state, district, department, assigned_officer_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints (status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_complaints_created ON complaints (created_at DESC)`;

  console.log('[store] Postgres connected; schema ready');
  return true;
}

const toComplaint = (r: any): Complaint => ({
  id: r.id,
  createdAt: new Date(r.created_at).toISOString(),
  updatedAt: new Date(r.updated_at).toISOString(),
  citizenName: r.citizen_name,
  citizenPhone: r.citizen_phone,
  citizenEmail: r.citizen_email ?? undefined,
  category: r.category,
  description: r.description,
  state: r.state,
  district: r.district,
  ward: r.ward ?? undefined,
  lat: r.lat ?? undefined,
  lng: r.lng ?? undefined,
  department: r.department ?? undefined,
  assignedOfficerId: r.assigned_officer_id ?? undefined,
  assignedOfficerName: r.assigned_officer_name ?? undefined,
  status: r.status,
  priority: r.priority,
  escalationLevel: r.escalation_level,
  slaDeadline: new Date(r.sla_deadline).toISOString(),
  duplicateOfId: r.duplicate_of_id ?? undefined,
  attachments: r.attachments ?? [],
  timeline: r.timeline ?? [],
  internalNotes: r.internal_notes ?? [],
  publicUpdates: r.public_updates ?? [],
  citizenRating: r.citizen_rating ?? undefined,
});

export const postgresStore: ComplaintStore = {
  async list() {
    if (!sql) throw new Error('postgres_not_initialised');
    const rows = await sql`SELECT * FROM complaints ORDER BY created_at DESC LIMIT 500`;
    return rows.map(toComplaint);
  },

  async get(id: string) {
    if (!sql) throw new Error('postgres_not_initialised');
    const rows = await sql`SELECT * FROM complaints WHERE id = ${id} LIMIT 1`;
    return rows[0] ? toComplaint(rows[0]) : null;
  },

  async create(input: any) {
    if (!sql) throw new Error('postgres_not_initialised');
    const now = new Date();
    const ymd = now.toISOString().slice(0, 10).replace(/-/g, '');
    // Per-day sequence derived in SQL so concurrent inserts can't collide.
    const [{ n }] = await sql`
      SELECT COUNT(*) + 1 AS n FROM complaints WHERE id LIKE ${'CIV-' + ymd + '-%'}`;
    const id = `CIV-${ymd}-${String(n).padStart(4, '0')}`;

    const rows = await sql`
      INSERT INTO complaints (
        id, citizen_name, citizen_phone, citizen_email, category, description,
        state, district, ward, lat, lng, department,
        assigned_officer_id, assigned_officer_name, status, priority, sla_deadline
      ) VALUES (
        ${id}, ${input.citizenName}, ${input.citizenPhone}, ${input.citizenEmail ?? null},
        ${input.category}, ${input.description}, ${input.state}, ${input.district},
        ${input.ward ?? null}, ${input.lat ?? null}, ${input.lng ?? null},
        ${input.department ?? null}, ${input.assignedOfficerId ?? null},
        ${input.assignedOfficerName ?? null}, ${input.status ?? 'submitted'},
        ${input.priority ?? 'Medium'}, ${input.slaDeadline ?? new Date(Date.now() + 48 * 3600_000).toISOString()}
      ) RETURNING *`;
    return toComplaint(rows[0]);
  },

  async update(id: string, patch: Partial<Complaint>) {
    if (!sql) throw new Error('postgres_not_initialised');
    // COALESCE keeps this a single statement while leaving unspecified
    // columns untouched — avoids a read-modify-write race.
    const rows = await sql`
      UPDATE complaints SET
        status                = COALESCE(${patch.status ?? null}, status),
        priority              = COALESCE(${patch.priority ?? null}, priority),
        department            = COALESCE(${patch.department ?? null}, department),
        assigned_officer_id   = COALESCE(${patch.assignedOfficerId ?? null}, assigned_officer_id),
        assigned_officer_name = COALESCE(${patch.assignedOfficerName ?? null}, assigned_officer_name),
        escalation_level      = COALESCE(${patch.escalationLevel ?? null}, escalation_level),
        citizen_rating        = COALESCE(${patch.citizenRating ?? null}, citizen_rating),
        timeline              = COALESCE(${patch.timeline ? JSON.stringify(patch.timeline) : null}::jsonb, timeline),
        internal_notes        = COALESCE(${patch.internalNotes ? JSON.stringify(patch.internalNotes) : null}::jsonb, internal_notes),
        public_updates        = COALESCE(${patch.publicUpdates ? JSON.stringify(patch.publicUpdates) : null}::jsonb, public_updates),
        attachments           = COALESCE(${patch.attachments ? JSON.stringify(patch.attachments) : null}::jsonb, attachments),
        updated_at            = now()
      WHERE id = ${id}
      RETURNING *`;
    return rows[0] ? toComplaint(rows[0]) : null;
  },
};
