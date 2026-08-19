import { OfficerWorkspace } from '../components/staff/OfficerWorkspace';
import { RequireRole, ROLE_GROUPS } from './RequireRole';
import { StaffShell } from './StaffShell';

/**
 * /portal/officer — the field officer's workspace.
 *
 * A field officer's scope is the ASSIGNMENT, not the district: a complaint
 * two streets away that belongs to a colleague is out of scope and is
 * filtered out server-side (see `inScope` in server/rbac.ts). So this shows
 * a genuinely personal worklist, not a district list with a filter on it.
 *
 * No charts. An officer with eleven open cases does not need a pie chart of
 * them — they need to know which one breaches first.
 */
export function OfficerPortalPage() {
  return (
    <RequireRole allow={ROLE_GROUPS.officer}>
      <StaffShell title="CivicAI" subtitle="Officer Workspace">
        <OfficerWorkspace />
      </StaffShell>
    </RequireRole>
  );
}
