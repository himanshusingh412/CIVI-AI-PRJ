-- ═══════════════════════════════════════════════════════════════════════
-- Row Level Security
--
-- IMPORTANT — why these policies do NOT use Supabase's auth.uid():
--
-- CivicAI issues its own HMAC-signed sessions (server/auth.ts); it does not
-- use Supabase Auth. So `auth.uid()` would be NULL on every request and the
-- policies would deny everything. Worse, a server connecting with the
-- service_role key BYPASSES RLS entirely — you would have policies that look
-- protective and enforce nothing.
--
-- Instead these policies read per-transaction session variables that the API
-- sets before running any query:
--
--     SET LOCAL app.user_id    = '<uuid>';
--     SET LOCAL app.role       = 'district_admin';
--     SET LOCAL app.state      = 'Delhi';
--     SET LOCAL app.district   = 'New Delhi';
--     SET LOCAL app.department = '<uuid or empty>';
--     SET LOCAL app.officer_id = '<uuid or empty>';
--
-- SET LOCAL scopes to the transaction, so a pooled connection cannot leak one
-- request's identity into the next.
--
-- This works identically on Supabase, Neon, and self-hosted Postgres, and it
-- keeps enforcement in the database even if an API route forgets its check.
-- It is defence in depth — server/rbac.ts remains the primary gate.
--
-- The DB user the app connects as must NOT own these tables and must NOT have
-- BYPASSRLS, or the policies are ignored. See the grant block at the bottom.
-- ═══════════════════════════════════════════════════════════════════════

-- ─────────────── helpers ───────────────
CREATE OR REPLACE FUNCTION app_setting(key TEXT)
RETURNS TEXT AS $$
  -- `true` = missing_ok, so an unset variable yields NULL rather than erroring.
  SELECT NULLIF(current_setting(key, true), '');
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION app_role() RETURNS TEXT AS $$
  SELECT COALESCE(app_setting('app.role'), 'anonymous');
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION app_user_id() RETURNS UUID AS $$
  SELECT app_setting('app.user_id')::uuid;
$$ LANGUAGE sql STABLE;

/**
 * True when the caller's jurisdiction covers the given record.
 * Mirrors inScope() in server/rbac.ts — the two must be changed together.
 */
CREATE OR REPLACE FUNCTION app_in_scope(
  rec_state TEXT, rec_district TEXT, rec_department UUID, rec_officer UUID
) RETURNS BOOLEAN AS $$
  -- COALESCE(..., FALSE) makes this STRICTLY two-valued.
  -- Without it, comparing against a NULL column (an unassigned complaint, or
  -- an unset session variable) yields NULL. A policy treats NULL as "not
  -- true" so it happens to deny — but the moment this is used inside NOT(),
  -- OR, or a CHECK, NULL stops behaving like FALSE and the deny silently
  -- becomes an allow. Never leave a security predicate three-valued.
  SELECT COALESCE(
    CASE app_role()
      WHEN 'super_admin' THEN TRUE
      WHEN 'auditor'     THEN TRUE
      WHEN 'state_admin' THEN rec_state = app_setting('app.state')
      WHEN 'district_admin' THEN rec_state = app_setting('app.state')
                             AND rec_district = app_setting('app.district')
      WHEN 'department_officer' THEN rec_state = app_setting('app.state')
                                 AND rec_department = app_setting('app.department')::uuid
      -- Field officers see only their own assignments, never a colleague's.
      -- An unassigned complaint (rec_officer IS NULL) must never match.
      WHEN 'field_officer' THEN rec_officer IS NOT NULL
                            AND app_setting('app.officer_id') IS NOT NULL
                            AND rec_officer = app_setting('app.officer_id')::uuid
      ELSE FALSE
    END,
  FALSE);
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION app_can_write() RETURNS BOOLEAN AS $$
  SELECT app_role() IN ('super_admin','state_admin','district_admin',
                        'department_officer','field_officer');
$$ LANGUAGE sql STABLE;

-- ─────────────── complaints ───────────────
ALTER TABLE complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE complaints FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS complaints_select ON complaints;
CREATE POLICY complaints_select ON complaints FOR SELECT USING (
  deleted_at IS NULL AND (
    -- Citizens see their own complaints; staff see their jurisdiction.
    user_id = app_user_id()
    OR app_in_scope(state, district, department_id, assigned_officer_id)
  )
);

DROP POLICY IF EXISTS complaints_insert ON complaints;
CREATE POLICY complaints_insert ON complaints FOR INSERT WITH CHECK (
  user_id = app_user_id() OR app_can_write()
);

DROP POLICY IF EXISTS complaints_update ON complaints;
CREATE POLICY complaints_update ON complaints FOR UPDATE
  USING (app_can_write() AND app_in_scope(state, district, department_id, assigned_officer_id))
  WITH CHECK (app_can_write());

-- No DELETE policy: hard deletes are impossible for everyone. Removal is a
-- soft delete via UPDATE deleted_at, which stays inside the audit trail.

-- ─────────────── users ───────────────
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_select ON users;
CREATE POLICY users_select ON users FOR SELECT USING (
  deleted_at IS NULL AND (
    id = app_user_id()
    OR app_role() IN ('super_admin','auditor')
    OR (app_role() = 'state_admin'    AND state = app_setting('app.state'))
    OR (app_role() = 'district_admin' AND state = app_setting('app.state')
                                      AND district = app_setting('app.district'))
  )
);

DROP POLICY IF EXISTS users_update ON users;
CREATE POLICY users_update ON users FOR UPDATE
  USING (id = app_user_id() OR app_role() = 'super_admin');

-- ─────────────── child tables inherit the parent's visibility ───────────────
ALTER TABLE complaint_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE complaint_media FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS media_select ON complaint_media;
CREATE POLICY media_select ON complaint_media FOR SELECT USING (
  deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM complaints c WHERE c.id = complaint_id)
);
DROP POLICY IF EXISTS media_insert ON complaint_media;
CREATE POLICY media_insert ON complaint_media FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM complaints c WHERE c.id = complaint_id)
);

ALTER TABLE complaint_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE complaint_status_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS history_select ON complaint_status_history;
-- Internal notes are filtered in the projection layer, not here: citizens may
-- read their own history rows, but the API strips internal_note for them.
CREATE POLICY history_select ON complaint_status_history FOR SELECT USING (
  EXISTS (SELECT 1 FROM complaints c WHERE c.id = complaint_id)
);
DROP POLICY IF EXISTS history_insert ON complaint_status_history;
CREATE POLICY history_insert ON complaint_status_history FOR INSERT WITH CHECK (app_can_write());

-- ─────────────── notifications: strictly own-row ───────────────
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notif_select ON notifications;
CREATE POLICY notif_select ON notifications FOR SELECT
  USING (deleted_at IS NULL AND user_id = app_user_id());
DROP POLICY IF EXISTS notif_update ON notifications;
CREATE POLICY notif_update ON notifications FOR UPDATE
  USING (user_id = app_user_id());

-- ─────────────── citizen_feedback ───────────────
ALTER TABLE citizen_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE citizen_feedback FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS feedback_select ON citizen_feedback;
CREATE POLICY feedback_select ON citizen_feedback FOR SELECT USING (
  deleted_at IS NULL AND (
    user_id = app_user_id()
    OR EXISTS (SELECT 1 FROM complaints c WHERE c.id = complaint_id)
  )
);
DROP POLICY IF EXISTS feedback_insert ON citizen_feedback;
CREATE POLICY feedback_insert ON citizen_feedback FOR INSERT
  WITH CHECK (user_id = app_user_id());

-- ─────────────── chatbot_history: private to the user ───────────────
ALTER TABLE chatbot_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE chatbot_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chat_own ON chatbot_history;
CREATE POLICY chat_own ON chatbot_history FOR ALL
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());

-- ─────────────── announcements / alerts: public read ───────────────
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ann_select ON announcements;
CREATE POLICY ann_select ON announcements FOR SELECT USING (
  deleted_at IS NULL AND (is_published OR app_can_write())
);
DROP POLICY IF EXISTS ann_write ON announcements;
CREATE POLICY ann_write ON announcements FOR ALL
  USING (app_role() IN ('super_admin','state_admin'))
  WITH CHECK (app_role() IN ('super_admin','state_admin'));

ALTER TABLE emergency_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE emergency_alerts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS alerts_select ON emergency_alerts;
CREATE POLICY alerts_select ON emergency_alerts FOR SELECT USING (deleted_at IS NULL);
DROP POLICY IF EXISTS alerts_write ON emergency_alerts;
CREATE POLICY alerts_write ON emergency_alerts FOR ALL
  USING (app_can_write()) WITH CHECK (app_can_write());

-- ─────────────── audit_logs: append-only, read-restricted ───────────────
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_select ON audit_logs;
CREATE POLICY audit_select ON audit_logs FOR SELECT
  USING (app_role() IN ('super_admin','state_admin','auditor'));
DROP POLICY IF EXISTS audit_insert ON audit_logs;
CREATE POLICY audit_insert ON audit_logs FOR INSERT WITH CHECK (TRUE);
-- Deliberately no UPDATE or DELETE policy. With RLS forced and no permissive
-- policy for those commands, every attempt affects zero rows — the log is
-- append-only at the database level, not merely by convention.

-- ─────────────── reference tables: readable, admin-writable ───────────────
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dept_select ON departments;
CREATE POLICY dept_select ON departments FOR SELECT USING (deleted_at IS NULL);
DROP POLICY IF EXISTS dept_write ON departments;
CREATE POLICY dept_write ON departments FOR ALL
  USING (app_role() = 'super_admin') WITH CHECK (app_role() = 'super_admin');

ALTER TABLE officers ENABLE ROW LEVEL SECURITY;
ALTER TABLE officers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS officers_select ON officers;
CREATE POLICY officers_select ON officers FOR SELECT USING (deleted_at IS NULL);
DROP POLICY IF EXISTS officers_write ON officers;
CREATE POLICY officers_write ON officers FOR ALL
  USING (app_role() IN ('super_admin','state_admin','district_admin'))
  WITH CHECK (app_role() IN ('super_admin','state_admin','district_admin'));

ALTER TABLE ai_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_analysis FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_select ON ai_analysis;
CREATE POLICY ai_select ON ai_analysis FOR SELECT USING (
  deleted_at IS NULL AND EXISTS (SELECT 1 FROM complaints c WHERE c.id = complaint_id)
);
DROP POLICY IF EXISTS ai_insert ON ai_analysis;
CREATE POLICY ai_insert ON ai_analysis FOR INSERT WITH CHECK (TRUE);

-- ─────────────── application role ───────────────
-- Run once as a superuser. The app MUST connect as civicai_app, not as the
-- table owner and not as Supabase's service_role — both bypass RLS.
--
--   CREATE ROLE civicai_app LOGIN PASSWORD '<strong password>';
--   GRANT USAGE ON SCHEMA public TO civicai_app;
--   GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO civicai_app;
--   REVOKE DELETE ON ALL TABLES IN SCHEMA public FROM civicai_app;
--   REVOKE UPDATE, DELETE ON audit_logs FROM civicai_app;
--   ALTER ROLE civicai_app NOBYPASSRLS;
