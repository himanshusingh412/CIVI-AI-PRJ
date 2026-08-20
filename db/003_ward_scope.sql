-- ═══════════════════════════════════════════════════════════════════════
-- 003 — Local-area (ward) as a first-class authorisation dimension
-- ═══════════════════════════════════════════════════════════════════════
--
-- WHY THIS MIGRATION EXISTS
--
-- The RBAC model scoped officers by state / district / department, but not
-- by ward, so "an area officer sees only their own ward" was not expressible
-- and therefore not enforced. Ward appeared in exactly one place - the
-- complaints_api view - as:
--
--     c.address AS ward
--
-- That alias is worse than simply missing, because it looks like a real
-- column at the call site. `address` is free text typed by the citizen who
-- filed the complaint. Had ward-based scoping been switched on against that
-- alias, the value deciding which officer may read a record would have been
-- supplied by the person filing it: type the string an officer's ward is
-- matched on and the complaint lands in their queue; type anything else and
-- it silently leaves every area officer's view. Authorisation input has to
-- be assigned by the system, never dictated by the subject of the record.
--
-- So this migration gives ward a real, system-assigned home on both sides of
-- the comparison: the complaint being read, and the officer reading it.
--
-- Additive and idempotent by construction - every statement is IF NOT EXISTS
-- or CREATE OR REPLACE. It adds nullable columns and never rewrites existing
-- rows, so it is safe to run against a populated production database and
-- safe to run twice.
-- ═══════════════════════════════════════════════════════════════════════

-- ─────────────────────────── complaints.ward ───────────────────────────
-- Nullable on purpose. A complaint arrives before anyone knows which ward
-- it belongs to, and backfilling from `address` would import precisely the
-- citizen-controlled values this migration exists to stop trusting.
--
-- NULL is the safe default: inScope() treats a principal's ward constraint
-- as a filter, so a complaint with ward IS NULL matches no area officer at
-- all. Un-warded complaints stay visible to district and department staff
-- (who carry no ward constraint) and are invisible to area officers until
-- somebody with authority actually assigns the ward. Fail-closed.
ALTER TABLE complaints  ADD COLUMN IF NOT EXISTS ward TEXT;

-- ──────────────────────── officers.assigned_ward ────────────────────────
-- The officer side of the same comparison. Sits alongside the existing
-- assigned_state / assigned_district, and is NULL for every role that is
-- not ward-bound (department, district, state, super admin), which is what
-- lets those roles keep their wildcard reach.
ALTER TABLE officers    ADD COLUMN IF NOT EXISTS assigned_ward TEXT;

-- ───────────────────────────── indexes ─────────────────────────────────
-- The hot query is an area officer's queue: "my department, my district, my
-- ward, still open". Composite ordered widest → narrowest so the same index
-- also serves department-only and department+district officers, who are the
-- roles immediately above this one and filter on a prefix of these columns.
CREATE INDEX IF NOT EXISTS idx_complaints_dept_district_ward
  ON complaints (department_id, district, ward)
  WHERE deleted_at IS NULL;

-- Resolving a signed-in officer to their jurisdiction happens on every
-- authenticated admin request, so it must not be a sequential scan.
CREATE INDEX IF NOT EXISTS idx_officers_jurisdiction
  ON officers (department_id, assigned_district, assigned_ward)
  WHERE deleted_at IS NULL;

-- ──────────────────────── complaints_api view ──────────────────────────
-- Re-pointed at the real column. Column name, position and type are all
-- unchanged (ward TEXT), which is what allows CREATE OR REPLACE rather than
-- a DROP - the latter would cascade to anything depending on this view.
--
-- Everything below is byte-identical to the definition in 001 except the
-- single ward line. It is restated in full because CREATE OR REPLACE VIEW
-- has no partial form.
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
  c.ward                                            AS ward,
  c.latitude                                        AS lat,
  c.longitude                                       AS lng,
  d.name                                            AS department,
  c.assigned_officer_id::text                       AS assigned_officer_id,
  o.officer_name                                    AS assigned_officer_name,
  c.status::text                                    AS status,
  c.priority::text                                  AS priority,
  c.escalation_level,
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
