import { useState } from 'react';
import { AdminPortal } from '../components/admin/AdminPortal';
import { OfficerWorkspace } from '../components/staff/OfficerWorkspace';
import { RequireRole, ROLE_GROUPS } from './RequireRole';
import { StaffShell } from './StaffShell';

/**
 * /portal/department — district and department administration.
 *
 * A district admin does two different jobs and they want different screens:
 * working the queue (what is late, what needs assigning) and reading the
 * department (how are we doing, where is it going wrong). Rather than
 * compromise into one screen that does both badly, this is two tabs.
 *
 * The queue tab and the overview tab render the same components the officer
 * and admin portals use — and that is not a shortcut. Both fetch through the
 * same scoped endpoints, so a district admin sees their district because the
 * rows for other districts never left the server, not because a prop told a
 * component to hide them.
 */
type Tab = 'queue' | 'overview';

export function DepartmentPortalPage() {
  const [tab, setTab] = useState<Tab>('queue');

  return (
    <RequireRole allow={ROLE_GROUPS.department}>
      <StaffShell title="CivicAI" subtitle="Department Administration">
        <div className="flex gap-1 surface-2 bordered rounded-xl p-1 w-fit mb-5" role="tablist">
          {([
            { key: 'queue' as const, label: 'Queue' },
            { key: 'overview' as const, label: 'Overview' },
          ]).map(t => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className="press px-3.5 py-1.5 rounded-lg text-[12.5px] font-bold transition-colors"
              style={{
                background: tab === t.key ? 'var(--color-cta)' : 'transparent',
                color: tab === t.key ? '#fff' : 'var(--color-content-3)',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'queue' ? <OfficerWorkspace /> : <AdminPortal />}
      </StaffShell>
    </RequireRole>
  );
}
