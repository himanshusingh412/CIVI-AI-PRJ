import { AdminPortal } from '../components/admin/AdminPortal';
import { RequireRole, ROLE_GROUPS } from './RequireRole';
import { StaffShell } from './StaffShell';

/**
 * /portal/department — district and department administration.
 *
 * Renders the same dashboard component as /portal/admin, and that is not a
 * shortcut: the dashboard shows whatever the SERVER returns, and the server
 * has already narrowed every list to the caller's jurisdiction. A district
 * admin opening this page sees their district because the rows for other
 * districts never left the building — not because a prop told the component
 * to hide them.
 */
export function DepartmentPortalPage() {
  return (
    <RequireRole allow={ROLE_GROUPS.department}>
      <StaffShell title="CivicAI" subtitle="Department Administration">
        <AdminPortal />
      </StaffShell>
    </RequireRole>
  );
}
