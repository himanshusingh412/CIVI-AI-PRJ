import { AdminPortal } from '../components/admin/AdminPortal';
import { RequireRole, ROLE_GROUPS } from './RequireRole';
import { StaffShell } from './StaffShell';

/**
 * /portal/officer — the field officer's queue.
 *
 * A field officer's scope is the ASSIGNMENT, not the district: a complaint
 * two streets away that belongs to a colleague is out of scope and is
 * filtered out server-side (see `inScope` in server/rbac.ts). So this route
 * shows a genuinely personal worklist, not a district list with a filter.
 */
export function OfficerPortalPage() {
  return (
    <RequireRole allow={ROLE_GROUPS.officer}>
      <StaffShell title="CivicAI" subtitle="Officer Workspace">
        <AdminPortal />
      </StaffShell>
    </RequireRole>
  );
}
