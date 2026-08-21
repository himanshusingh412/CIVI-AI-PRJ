import { AdminPortal } from '../components/admin/AdminPortal';
import { RequireRole, ROLE_GROUPS } from './RequireRole';
import { StaffShell } from './StaffShell';

/**
 * /portal/admin — system-wide administration.
 *
 * Structurally separate from the citizen app: its own chrome, its own
 * navigation, no shared sidebar. The only thing the portals share is the
 * backend, which is the point.
 *
 * Auditors are allowed in deliberately. They can read everything and change
 * nothing — the RBAC matrix enforces that, so giving them the full
 * dashboard is correct rather than generous.
 */
export function AdminPortalPage() {
  return (
    <RequireRole allow={ROLE_GROUPS.admin} signInPath="/admin/login">
      <StaffShell title="CivicAI" subtitle="Grievance Administration">
        <AdminPortal />
      </StaffShell>
    </RequireRole>
  );
}
