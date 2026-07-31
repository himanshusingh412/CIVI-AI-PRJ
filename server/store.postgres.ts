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
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Complaint, ComplaintStore } from './store.js';
import { splitStatements } from '../db/sql-split.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type SqlClient = ((strings: TemplateStringsArray, ...values: unknown[]) => Promise<any[]>) & {
  query: (text: string, params?: unknown[]) => Promise<any>;
};

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

  /**
   * Apply the canonical schema from db/001_schema.sql.
   *
   * This file used to define its OWN `complaints` table inline — a
   * denormalized TEXT-keyed design with JSONB sub-documents — while
   * db/001_schema.sql defined a normalized UUID-keyed one across 14 tables.
   * Two schema authorities for the same table name.
   *
   * Because both used CREATE TABLE IF NOT EXISTS, whichever ran first won
   * silently and the other became a no-op. The server usually started first,
   * so the seed then failed on `CREATE UNIQUE INDEX ... WHERE deleted_at IS
   * NULL` against a table that had no deleted_at. The error looked like a
   * broken migration; the real fault was two designs disagreeing.
   *
   * There is now exactly one source of truth, and it is the .sql file.
   */
  const schemaPath = path.join(__dirname, '..', 'db', '001_schema.sql');
  const statements = splitStatements(fs.readFileSync(schemaPath, 'utf8'));
  // One statement per round trip: the neon() HTTP driver sends each query as
  // a prepared statement, and Postgres refuses multiple commands in one.
  for (const stmt of statements) await sql.query(stmt);

  console.log(`[store] Postgres connected; canonical schema applied (${statements.length} statements)`);
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
    // complaints_api, not complaints: the view flattens the normalized
    // tables into the row shape toComplaint() expects. See db/001_schema.sql.
    const rows = await sql`SELECT * FROM complaints_api ORDER BY created_at DESC LIMIT 500`;
    return rows.map(toComplaint);
  },

  async get(id: string) {
    if (!sql) throw new Error('postgres_not_initialised');
    const rows = await sql`SELECT * FROM complaints_api WHERE id = ${id} LIMIT 1`;
    return rows[0] ? toComplaint(rows[0]) : null;
  },

  async create(input: any) {
    if (!sql) throw new Error('postgres_not_initialised');
    const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '');

    /**
     * Resolve the citizen to a users row.
     *
     * The app layer only knows a name/phone/email; the normalized schema
     * wants a UUID foreign key. Matching on phone (which carries a partial
     * unique index) keeps a repeat complainant as one person rather than
     * accumulating a duplicate user per complaint.
     */
    let userId: string | null = null;
    if (input.citizenPhone || input.citizenEmail) {
      const found = await sql`
        SELECT id FROM users
        WHERE deleted_at IS NULL
          AND ((${input.citizenPhone ?? null}::text IS NOT NULL AND phone = ${input.citizenPhone ?? null})
            OR (${input.citizenEmail ?? null}::text IS NOT NULL AND lower(email) = lower(${input.citizenEmail ?? null})))
        LIMIT 1`;
      if (found[0]) userId = found[0].id;
      else {
        /**
         * users.role_id is NOT NULL, so a new citizen cannot be created
         * before the Citizen role exists. On a schema-only database (no
         * seed) that role is absent, which would make the very first
         * complaint submission fail. Create it on demand instead of
         * assuming the seed has run.
         */
        const role = await sql`
          SELECT id FROM roles WHERE role_name = 'Citizen' AND deleted_at IS NULL LIMIT 1`;
        const roleId = role[0]?.id ?? (await sql`
          INSERT INTO roles (role_name, permissions)
          VALUES ('Citizen', '["complaint:create","complaint:read_own"]'::jsonb)
          RETURNING id`)[0].id;

        const made = await sql`
          INSERT INTO users (full_name, phone, email, state, district, role_id)
          VALUES (${input.citizenName ?? 'Anonymous'}, ${input.citizenPhone ?? null},
                  ${input.citizenEmail ?? null}, ${input.state ?? null},
                  ${input.district ?? null}, ${roleId})
          RETURNING id`;
        userId = made[0].id;
      }
    }

    // Department arrives as a display name; the FK wants an id. An unknown
    // name resolves to NULL rather than failing the insert — an unrouted
    // complaint is recoverable, a rejected one is lost.
    const dept = input.department
      ? await sql`SELECT id FROM departments WHERE name = ${input.department} AND deleted_at IS NULL LIMIT 1`
      : [];
    const departmentId = dept[0]?.id ?? null;

    // Officer ids from the demo constants are not UUIDs, so validate the
    // shape before letting Postgres reject the whole statement.
    const officerId =
      typeof input.assignedOfficerId === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.assignedOfficerId)
        ? input.assignedOfficerId
        : null;

    const status = input.status ?? 'submitted';
    // `title` is NOT NULL here but has no counterpart in the app model.
    // Derive it from the description rather than inventing a column.
    const title = String(input.description ?? '').trim().slice(0, 120) || input.category || 'Complaint';

    /**
     * reference_no is generated inside the INSERT so the count and the write
     * happen in one statement. Doing it as two round trips lets two
     * concurrent submissions read the same count and collide.
     */
    const rows = await sql`
      INSERT INTO complaints (
        reference_no, user_id, department_id, assigned_officer_id,
        category, title, description, status, priority,
        latitude, longitude, address, district, state, sla_deadline
      ) VALUES (
        ${'CIV-' + ymd + '-'} || lpad((
          SELECT COUNT(*) + 1 FROM complaints WHERE reference_no LIKE ${'CIV-' + ymd + '-%'}
        )::text, 4, '0'),
        ${userId}, ${departmentId}, ${officerId},
        ${input.category}, ${title}, ${input.description},
        ${status}::complaint_status, ${input.priority ?? 'Medium'}::priority_level,
        ${input.lat ?? null}, ${input.lng ?? null}, ${input.ward ?? null},
        ${input.district}, ${input.state},
        ${input.slaDeadline ?? new Date(Date.now() + 48 * 3600_000).toISOString()}
      ) RETURNING id, reference_no`;

    // The opening timeline entry is a history row, not a JSONB blob — that
    // is what makes the audit trail queryable instead of merely displayable.
    await sql`
      INSERT INTO complaint_status_history (complaint_id, new_status, public_note)
      VALUES (${rows[0].id}, ${status}::complaint_status, 'Complaint received')`;

    const created = await sql`SELECT * FROM complaints_api WHERE id = ${rows[0].reference_no} LIMIT 1`;
    return toComplaint(created[0]);
  },

  async update(id: string, patch: Partial<Complaint>) {
    if (!sql) throw new Error('postgres_not_initialised');

    // `id` is the human reference_no; every write below keys off the UUID.
    const found = await sql`
      SELECT id, status::text AS status FROM complaints
      WHERE reference_no = ${id} AND deleted_at IS NULL LIMIT 1`;
    if (!found[0]) return null;
    const { id: uuid, status: previous } = found[0];

    const dept = patch.department
      ? await sql`SELECT id FROM departments WHERE name = ${patch.department} AND deleted_at IS NULL LIMIT 1`
      : [];

    await sql`
      UPDATE complaints SET
        status           = COALESCE(${patch.status ?? null}::complaint_status, status),
        priority         = COALESCE(${patch.priority ?? null}::priority_level, priority),
        department_id    = COALESCE(${dept[0]?.id ?? null}::uuid, department_id),
        escalation_level = COALESCE(${patch.escalationLevel ?? null}::int, escalation_level),
        -- The CHECK constraint refuses a closed complaint with no closed_date,
        -- so stamp it here rather than letting the constraint reject the write.
        closed_date      = CASE WHEN ${patch.status ?? null} = 'closed'
                                THEN COALESCE(closed_date, now()) ELSE closed_date END,
        updated_at       = now()
      WHERE id = ${uuid}`;

    // Append history only when something actually happened, so the audit
    // trail does not fill with no-op rows on every save.
    const note = patch.publicUpdates?.at(-1)?.body ?? null;
    const internal = patch.internalNotes?.at(-1)?.body ?? null;
    if ((patch.status && patch.status !== previous) || note || internal) {
      await sql`
        INSERT INTO complaint_status_history
          (complaint_id, previous_status, new_status, public_note, internal_note)
        VALUES (${uuid}, ${previous}::complaint_status,
                ${patch.status ?? previous}::complaint_status, ${note}, ${internal})`;
    }

    if (typeof patch.citizenRating === 'number') {
      await sql`
        INSERT INTO citizen_feedback (complaint_id, rating)
        VALUES (${uuid}, ${patch.citizenRating})`;
    }

    const rows = await sql`SELECT * FROM complaints_api WHERE id = ${id} LIMIT 1`;
    return rows[0] ? toComplaint(rows[0]) : null;
  },
};
