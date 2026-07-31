-- ═══════════════════════════════════════════════════════════════════════
-- CivicAI — schema
--
-- Portable PostgreSQL 14+. Runs unchanged on Supabase, Neon, or plain PG.
-- Supabase-only concerns (RLS policies, storage buckets, realtime) live in
-- 002_rls.sql so this file stays provider-neutral.
--
-- Conventions applied to every domain table:
--   id          UUID primary key (gen_random_uuid, built in since PG13)
--   created_at / updated_at   timestamptz, updated_at maintained by trigger
--   deleted_at  nullable — soft delete; all reads filter it out
--   created_by / updated_by   FK to users, nullable for system-generated rows
--
-- Soft-delete note: `deleted_at` and UNIQUE constraints conflict — a deleted
-- row would still occupy its unique slot. Unique indexes here are therefore
-- PARTIAL (`WHERE deleted_at IS NULL`), so an address can be reused after
-- the old account is removed.
-- ═══════════════════════════════════════════════════════════════════════

-- ─────────────────────────── enums ───────────────────────────
-- Enums over CHECK constraints: they're introspectable, self-documenting,
-- and reject bad values at write time rather than at read time.
DO $$ BEGIN
  CREATE TYPE user_status     AS ENUM ('active','suspended','pending','deactivated');
  CREATE TYPE complaint_status AS ENUM (
    'submitted','ai_verification','department_assigned','officer_assigned',
    'investigation_started','field_visit_scheduled','evidence_uploaded',
    'work_in_progress','resolved','citizen_verification','closed',
    'reopened','rejected_spam','merged');
  CREATE TYPE priority_level  AS ENUM ('Low','Medium','High','Critical');
  CREATE TYPE media_kind      AS ENUM ('image','video','audio','document');
  CREATE TYPE notify_channel  AS ENUM ('in_app','email','sms','whatsapp','push');
  CREATE TYPE delivery_status AS ENUM ('pending','sent','delivered','failed','read');
  CREATE TYPE alert_severity  AS ENUM ('info','warning','severe','critical');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─────────────────────────── updated_at trigger ───────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- ═══════════════════════════ 2. roles ═══════════════════════════
-- Created before users because users.role_id references it.
CREATE TABLE IF NOT EXISTS roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_name   TEXT NOT NULL,
  description TEXT,
  -- Permission list as JSONB so roles are editable without a migration.
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ,
  created_by  UUID,
  updated_by  UUID
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_roles_name ON roles (role_name) WHERE deleted_at IS NULL;

-- ═══════════════════════════ 3. departments ═══════════════════════════
CREATE TABLE IF NOT EXISTS departments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  code        TEXT NOT NULL,
  description TEXT,
  state       TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  -- Default SLA for this department, overridden per-priority in app logic.
  sla_hours   INTEGER NOT NULL DEFAULT 48 CHECK (sla_hours > 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ,
  created_by  UUID,
  updated_by  UUID
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_departments_code ON departments (code) WHERE deleted_at IS NULL;

-- ═══════════════════════════ 1. users ═══════════════════════════
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name     TEXT NOT NULL,
  email         TEXT,
  phone         TEXT,
  google_id     TEXT,
  profile_image TEXT,
  role_id       UUID NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  state         TEXT,
  district      TEXT,
  language      TEXT NOT NULL DEFAULT 'en',
  is_verified   BOOLEAN NOT NULL DEFAULT FALSE,
  last_login    TIMESTAMPTZ,
  status        user_status NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  -- A user must be reachable by something, or notifications are impossible.
  CONSTRAINT users_contactable CHECK (email IS NOT NULL OR phone IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email     ON users (lower(email)) WHERE deleted_at IS NULL AND email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_phone     ON users (phone)        WHERE deleted_at IS NULL AND phone IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_google_id ON users (google_id)    WHERE deleted_at IS NULL AND google_id IS NOT NULL;
-- Admin lists filter by jurisdiction constantly.
CREATE INDEX IF NOT EXISTS idx_users_scope ON users (state, district) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_role  ON users (role_id)         WHERE deleted_at IS NULL;

-- ═══════════════════════════ 7. officers ═══════════════════════════
CREATE TABLE IF NOT EXISTS officers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES users(id) ON DELETE SET NULL,
  officer_name      TEXT NOT NULL,
  department_id     UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  designation       TEXT,
  contact_phone     TEXT,
  contact_email     TEXT,
  assigned_state    TEXT NOT NULL,
  assigned_district TEXT NOT NULL,
  -- Denormalised counter. Kept current by trigger (see 003) rather than a
  -- COUNT(*) on every dashboard render, which would dominate the query plan
  -- once complaints grow past a few hundred thousand rows.
  current_workload  INTEGER NOT NULL DEFAULT 0 CHECK (current_workload >= 0),
  max_workload      INTEGER NOT NULL DEFAULT 25 CHECK (max_workload > 0),
  is_available      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ,
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by        UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_officers_dept  ON officers (department_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_officers_scope ON officers (assigned_state, assigned_district) WHERE deleted_at IS NULL;
-- Partial index: assignment only ever searches officers with capacity.
CREATE INDEX IF NOT EXISTS idx_officers_available
  ON officers (department_id, current_workload)
  WHERE deleted_at IS NULL AND is_available;

-- ═══════════════════════════ 4. complaints ═══════════════════════════
CREATE TABLE IF NOT EXISTS complaints (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Human-facing reference (CIV-20260731-0001). Separate from the UUID so
  -- citizens quote something short, while joins stay on the surrogate key.
  reference_no         TEXT NOT NULL,
  user_id              UUID REFERENCES users(id) ON DELETE SET NULL,
  department_id        UUID REFERENCES departments(id) ON DELETE SET NULL,
  assigned_officer_id  UUID REFERENCES officers(id) ON DELETE SET NULL,

  category             TEXT NOT NULL,
  subcategory          TEXT,
  title                TEXT NOT NULL,
  description          TEXT NOT NULL,

  ai_summary           TEXT,
  ai_priority          priority_level,
  ai_classification    TEXT,

  status               complaint_status NOT NULL DEFAULT 'submitted',
  priority             priority_level NOT NULL DEFAULT 'Medium',

  latitude             DOUBLE PRECISION CHECK (latitude  BETWEEN -90  AND 90),
  longitude            DOUBLE PRECISION CHECK (longitude BETWEEN -180 AND 180),
  address              TEXT,
  district             TEXT NOT NULL,
  state                TEXT NOT NULL,

  estimated_resolution TIMESTAMPTZ,
  sla_deadline         TIMESTAMPTZ,
  escalation_level     INTEGER NOT NULL DEFAULT 0 CHECK (escalation_level BETWEEN 0 AND 5),
  citizen_rating       INTEGER CHECK (citizen_rating BETWEEN 1 AND 5),
  closed_date          TIMESTAMPTZ,
  duplicate_of_id      UUID REFERENCES complaints(id) ON DELETE SET NULL,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at           TIMESTAMPTZ,
  created_by           UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by           UUID REFERENCES users(id) ON DELETE SET NULL,

  -- A closed complaint must record when. Enforced here rather than in app
  -- code so no code path can produce a half-closed row.
  CONSTRAINT complaints_closed_has_date
    CHECK (status <> 'closed' OR closed_date IS NOT NULL),
  -- A complaint cannot be its own duplicate.
  CONSTRAINT complaints_no_self_duplicate
    CHECK (duplicate_of_id IS NULL OR duplicate_of_id <> id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_complaints_ref ON complaints (reference_no) WHERE deleted_at IS NULL;

-- Composite index mirroring the RBAC scope predicate — every admin list
-- query filters on some prefix of (state, district, department, officer).
CREATE INDEX IF NOT EXISTS idx_complaints_scope
  ON complaints (state, district, department_id, assigned_officer_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_complaints_status  ON complaints (status)               WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_complaints_created ON complaints (created_at DESC)      WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_complaints_user    ON complaints (user_id, created_at DESC) WHERE deleted_at IS NULL;
-- Partial index for the SLA-breach dashboard: only open rows can breach, so
-- indexing closed ones wastes space and slows writes.
CREATE INDEX IF NOT EXISTS idx_complaints_open_sla
  ON complaints (sla_deadline)
  WHERE deleted_at IS NULL AND status NOT IN ('closed','rejected_spam','merged');
-- Trigram-free full-text search across title + description.
CREATE INDEX IF NOT EXISTS idx_complaints_fts
  ON complaints USING GIN (to_tsvector('english', title || ' ' || description));

-- ═══════════════════════════ 5. complaint_media ═══════════════════════════
CREATE TABLE IF NOT EXISTS complaint_media (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id  UUID NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  kind          media_kind NOT NULL,
  -- Only the URL/key is stored; bytes live in Supabase Storage or S3.
  file_url      TEXT NOT NULL,
  storage_key   TEXT,
  file_name     TEXT,
  mime_type     TEXT,
  file_size     BIGINT CHECK (file_size >= 0),
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by    UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_media_complaint ON complaint_media (complaint_id) WHERE deleted_at IS NULL;

-- ═══════════════════ 6. complaint_status_history ═══════════════════
CREATE TABLE IF NOT EXISTS complaint_status_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id    UUID NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  previous_status complaint_status,
  new_status      complaint_status NOT NULL,
  updated_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  public_note     TEXT,   -- visible to the citizen
  internal_note   TEXT,   -- staff only
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_history_complaint ON complaint_status_history (complaint_id, created_at DESC);

-- ═══════════════════════════ 8. notifications ═══════════════════════════
CREATE TABLE IF NOT EXISTS notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  complaint_id    UUID REFERENCES complaints(id) ON DELETE CASCADE,
  title           TEXT,
  message         TEXT NOT NULL,
  channel         notify_channel NOT NULL DEFAULT 'in_app',
  is_read         BOOLEAN NOT NULL DEFAULT FALSE,
  delivery_status delivery_status NOT NULL DEFAULT 'pending',
  delivered_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by      UUID REFERENCES users(id) ON DELETE SET NULL
);
-- The bell badge only ever counts unread rows — partial index keeps that O(1)-ish.
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications (user_id, created_at DESC)
  WHERE deleted_at IS NULL AND is_read = FALSE;

-- ═══════════════════════════ 9. ai_analysis ═══════════════════════════
CREATE TABLE IF NOT EXISTS ai_analysis (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id             UUID NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  ai_classification        TEXT,
  confidence_score         NUMERIC(4,3) CHECK (confidence_score BETWEEN 0 AND 1),
  is_duplicate             BOOLEAN NOT NULL DEFAULT FALSE,
  duplicate_of_id          UUID REFERENCES complaints(id) ON DELETE SET NULL,
  spam_score               NUMERIC(4,3) CHECK (spam_score BETWEEN 0 AND 1),
  suggested_department_id  UUID REFERENCES departments(id) ON DELETE SET NULL,
  suggested_priority       priority_level,
  estimated_resolution_hrs INTEGER CHECK (estimated_resolution_hrs >= 0),
  model                    TEXT,
  raw_response             JSONB,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at               TIMESTAMPTZ,
  created_by               UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by               UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_complaint ON ai_analysis (complaint_id) WHERE deleted_at IS NULL;
-- Spam triage queue.
CREATE INDEX IF NOT EXISTS idx_ai_spam ON ai_analysis (spam_score DESC) WHERE deleted_at IS NULL AND spam_score > 0.5;

-- ═══════════════════════════ 10. audit_logs ═══════════════════════════
-- Append-only: no updated_at/deleted_at, and 002 revokes UPDATE/DELETE.
CREATE TABLE IF NOT EXISTS audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  table_name  TEXT NOT NULL,
  record_id   UUID,
  old_values  JSONB,
  new_values  JSONB,
  ip_address  INET,
  device      TEXT,
  -- Tamper-evidence: each row chains to the previous one's hash.
  prev_hash   TEXT,
  hash        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_user   ON audit_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_record ON audit_logs (table_name, record_id, created_at DESC);

-- ═══════════════════════════ 11. citizen_feedback ═══════════════════════════
CREATE TABLE IF NOT EXISTS citizen_feedback (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id             UUID NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  user_id                  UUID REFERENCES users(id) ON DELETE SET NULL,
  rating                   INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  feedback                 TEXT,
  resolution_satisfaction  BOOLEAN,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at               TIMESTAMPTZ,
  created_by               UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by               UUID REFERENCES users(id) ON DELETE SET NULL
);
-- One feedback per complaint (soft-delete aware).
CREATE UNIQUE INDEX IF NOT EXISTS uq_feedback_complaint
  ON citizen_feedback (complaint_id) WHERE deleted_at IS NULL;

-- ═══════════════════════════ 12. announcements ═══════════════════════════
CREATE TABLE IF NOT EXISTS announcements (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  state        TEXT,      -- NULL = nationwide
  district     TEXT,      -- NULL = whole state
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  published_at TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT announcements_expiry_after_publish
    CHECK (expires_at IS NULL OR published_at IS NULL OR expires_at > published_at)
);
CREATE INDEX IF NOT EXISTS idx_announcements_live
  ON announcements (state, district, published_at DESC)
  WHERE deleted_at IS NULL AND is_published;

-- ═══════════════════════════ 13. chatbot_history ═══════════════════════════
CREATE TABLE IF NOT EXISTS chatbot_history (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES users(id) ON DELETE CASCADE,
  session_id   UUID,
  question     TEXT NOT NULL,
  ai_response  TEXT NOT NULL,
  provider     TEXT,
  complaint_id UUID REFERENCES complaints(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by   UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_user ON chatbot_history (user_id, created_at DESC) WHERE deleted_at IS NULL;

-- ═══════════════════════════ 14. emergency_alerts ═══════════════════════════
CREATE TABLE IF NOT EXISTS emergency_alerts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type   TEXT NOT NULL,
  severity     alert_severity NOT NULL DEFAULT 'warning',
  title        TEXT NOT NULL,
  message      TEXT,
  state        TEXT,
  district     TEXT,
  latitude     DOUBLE PRECISION CHECK (latitude  BETWEEN -90  AND 90),
  longitude    DOUBLE PRECISION CHECK (longitude BETWEEN -180 AND 180),
  radius_km    NUMERIC(6,2) CHECK (radius_km > 0),
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  starts_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at      TIMESTAMPTZ,
  complaint_id UUID REFERENCES complaints(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT alerts_end_after_start CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_alerts_active
  ON emergency_alerts (state, district, severity)
  WHERE deleted_at IS NULL AND is_active;

-- ─────────────────────── updated_at triggers ───────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'roles','departments','users','officers','complaints','complaint_media',
    'complaint_status_history','notifications','ai_analysis','citizen_feedback',
    'announcements','chatbot_history','emergency_alerts'
  ] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON %1$s;
       CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON %1$s
       FOR EACH ROW EXECUTE FUNCTION set_updated_at();', t);
  END LOOP;
END $$;

-- ─────────────────── officer workload maintenance ───────────────────
-- Keeps officers.current_workload accurate without a COUNT(*) per read.
CREATE OR REPLACE FUNCTION sync_officer_workload() RETURNS trigger AS $$
DECLARE
  open_statuses complaint_status[] := ARRAY[
    'officer_assigned','investigation_started','field_visit_scheduled',
    'evidence_uploaded','work_in_progress','reopened']::complaint_status[];
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') AND OLD.assigned_officer_id IS NOT NULL THEN
    UPDATE officers SET current_workload = GREATEST(0, current_workload - 1)
    WHERE id = OLD.assigned_officer_id AND OLD.status = ANY(open_statuses);
  END IF;
  IF TG_OP IN ('INSERT','UPDATE') AND NEW.assigned_officer_id IS NOT NULL THEN
    UPDATE officers SET current_workload = current_workload + 1
    WHERE id = NEW.assigned_officer_id AND NEW.status = ANY(open_statuses);
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_complaints_workload ON complaints;
CREATE TRIGGER trg_complaints_workload
  AFTER INSERT OR UPDATE OF assigned_officer_id, status OR DELETE ON complaints
  FOR EACH ROW EXECUTE FUNCTION sync_officer_workload();

-- ─────────────────── active-row views ───────────────────
-- Application reads go through these so a forgotten `deleted_at IS NULL`
-- can't silently resurrect deleted records.
CREATE OR REPLACE VIEW v_active_complaints AS SELECT * FROM complaints WHERE deleted_at IS NULL;
CREATE OR REPLACE VIEW v_active_users      AS SELECT * FROM users      WHERE deleted_at IS NULL;
CREATE OR REPLACE VIEW v_active_officers   AS SELECT * FROM officers   WHERE deleted_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────
-- complaints_api — the shape the application layer reads.
--
-- The server used to own a second, denormalized `complaints` table with
-- JSONB sub-documents. Two CREATE TABLE IF NOT EXISTS statements for the
-- same name meant whichever ran first won and the other silently no-op'd,
-- which is how a partial index on `deleted_at` ended up failing against a
-- table that had no such column.
--
-- This view is the reconciliation: the normalized tables stay the single
-- source of truth, and the flat row shape the app already expects is
-- derived here rather than duplicated as a second physical table.
-- ─────────────────────────────────────────────────────────────────────
-- Image bytes. See server/media.ts for why these live in Postgres rather
-- than object storage at this stage, and what the exit path looks like.
ALTER TABLE complaint_media ADD COLUMN IF NOT EXISTS content BYTEA;

CREATE OR REPLACE VIEW complaints_api AS
SELECT
  c.reference_no                                    AS id,
  c.id                                              AS uuid,
  c.created_at,
  c.updated_at,
  COALESCE(u.full_name, 'Anonymous')                AS citizen_name,
  COALESCE(u.phone, '')                             AS citizen_phone,
  u.email                                           AS citizen_email,
  c.category,
  c.description,
  c.state,
  c.district,
  c.address                                         AS ward,
  c.latitude                                        AS lat,
  c.longitude                                       AS lng,
  d.name                                            AS department,
  c.assigned_officer_id::text                       AS assigned_officer_id,
  o.officer_name                                    AS assigned_officer_name,
  c.status::text                                    AS status,
  c.priority::text                                  AS priority,
  c.escalation_level,
  -- sla_deadline is nullable in the base table; the app's mapper calls
  -- new Date() on it unconditionally, so never hand it a NULL.
  COALESCE(c.sla_deadline, c.created_at)            AS sla_deadline,
  dup.reference_no                                  AS duplicate_of_id,
  COALESCE(m.items, '[]'::jsonb)                    AS attachments,
  COALESCE(h.items, '[]'::jsonb)                    AS timeline,
  COALESCE(n.items, '[]'::jsonb)                    AS internal_notes,
  COALESCE(p.items, '[]'::jsonb)                    AS public_updates,
  f.rating                                          AS citizen_rating
FROM complaints c
LEFT JOIN users       u   ON u.id   = c.user_id
LEFT JOIN departments d   ON d.id   = c.department_id
LEFT JOIN officers    o   ON o.id   = c.assigned_officer_id
LEFT JOIN complaints  dup ON dup.id = c.duplicate_of_id
LEFT JOIN LATERAL (
  SELECT jsonb_agg(jsonb_build_object(
           'url', cm.file_url, 'name', cm.file_name,
           'mime', cm.mime_type, 'size', cm.file_size) ORDER BY cm.uploaded_at) AS items
  FROM complaint_media cm
  WHERE cm.complaint_id = c.id AND cm.deleted_at IS NULL
) m ON TRUE
LEFT JOIN LATERAL (
  SELECT jsonb_agg(jsonb_build_object(
           'at', sh.created_at, 'status', sh.new_status::text,
           'note', sh.public_note) ORDER BY sh.created_at) AS items
  FROM complaint_status_history sh
  WHERE sh.complaint_id = c.id AND sh.deleted_at IS NULL
) h ON TRUE
LEFT JOIN LATERAL (
  SELECT jsonb_agg(jsonb_build_object(
           'at', sh.created_at, 'authorId', COALESCE(sh.updated_by::text, ''),
           'authorName', '', 'body', sh.internal_note) ORDER BY sh.created_at) AS items
  FROM complaint_status_history sh
  WHERE sh.complaint_id = c.id AND sh.deleted_at IS NULL AND sh.internal_note IS NOT NULL
) n ON TRUE
LEFT JOIN LATERAL (
  SELECT jsonb_agg(jsonb_build_object(
           'at', sh.created_at, 'body', sh.public_note) ORDER BY sh.created_at) AS items
  FROM complaint_status_history sh
  WHERE sh.complaint_id = c.id AND sh.deleted_at IS NULL AND sh.public_note IS NOT NULL
) p ON TRUE
LEFT JOIN LATERAL (
  SELECT cf.rating FROM citizen_feedback cf
  WHERE cf.complaint_id = c.id AND cf.deleted_at IS NULL
  ORDER BY cf.created_at DESC LIMIT 1
) f ON TRUE
WHERE c.deleted_at IS NULL;
