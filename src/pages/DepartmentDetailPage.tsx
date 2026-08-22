import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Building2, ShieldAlert, CheckCircle2, Clock, AlertTriangle, UserCheck, RefreshCw } from 'lucide-react';
import { StaffShell } from '../portals/StaffShell';
import { RequireRole, ROLE_GROUPS } from '../portals/RequireRole';
import { Button } from '../components/Button';
import { fetchDepartmentDetail, fetchOfficers, type AdminComplaint, type DepartmentSummary, type AssignableOfficer, isAuthError } from '../services/adminService';
import { statusLabel, departmentLabel } from '../i18n/labels';
import { useT } from '../i18n/I18nContext';
import { formatOfficerWithEmpId } from '../services/officerUtils';

export function DepartmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const t = useT();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<DepartmentSummary | null>(null);
  const [complaints, setComplaints] = useState<AdminComplaint[]>([]);
  const [officers, setOfficers] = useState<AssignableOfficer[]>([]);

  const loadData = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [deptRes, officerRes] = await Promise.all([
        fetchDepartmentDetail(id),
        fetchOfficers(),
      ]);

      if (isAuthError(deptRes)) {
        setError(deptRes.message);
      } else if (deptRes.ok) {
        setSummary(deptRes.summary);
        setComplaints(deptRes.complaints || []);
      }

      if (!isAuthError(officerRes) && officerRes.ok) {
        setOfficers(officerRes.officers || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load department details.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [id]);

  const deptName = id ? id.charAt(0).toUpperCase() + id.slice(1) : 'Department';

  return (
    <RequireRole allow={ROLE_GROUPS.department} signInPath="/admin/login">
      <StaffShell title={`Department: ${deptName}`} subtitle={`Manage ${deptName} operations, SLAs, and officers`}>
        <div className="flex flex-col gap-6 max-w-7xl mx-auto w-full">
          {/* Header Navigation */}
          <div className="flex items-center justify-between">
            <Link to="/portal/admin" className="inline-flex items-center gap-2 text-sm font-semibold text-content-3 hover:text-content transition-colors">
              <ArrowLeft size={16} />
              <span>Back to Admin Portal</span>
            </Link>

            <Button size="sm" variant="secondary" icon={<RefreshCw size={14} />} onClick={loadData}>
              Refresh
            </Button>
          </div>

          {error && (
            <div className="surface bordered rounded-xl p-4 flex items-center gap-3 text-danger">
              <ShieldAlert size={20} />
              <span className="text-sm font-semibold">{error}</span>
            </div>
          )}

          {/* Metric Overview Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="surface bordered rounded-2xl p-4 flex flex-col justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-content-3">Total Complaints</span>
              <span className="text-2xl font-display font-extrabold text-content mt-2">{summary?.total ?? complaints.length}</span>
            </div>
            <div className="surface bordered rounded-2xl p-4 flex flex-col justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-content-3">Unassigned</span>
              <span className="text-2xl font-display font-extrabold mt-2" style={{ color: 'var(--color-warning)' }}>
                {summary?.unassigned ?? complaints.filter(c => !c.assignedOfficerId).length}
              </span>
            </div>
            <div className="surface bordered rounded-2xl p-4 flex flex-col justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-content-3">Overdue SLA</span>
              <span className="text-2xl font-display font-extrabold mt-2 text-danger">
                {summary?.overdue ?? complaints.filter(c => Date.parse(c.slaDeadline) < Date.now()).length}
              </span>
            </div>
            <div className="surface bordered rounded-2xl p-4 flex flex-col justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-content-3">Resolved</span>
              <span className="text-2xl font-display font-extrabold text-success mt-2">
                {summary?.resolved ?? complaints.filter(c => c.status === 'resolved' || c.status === 'closed').length}
              </span>
            </div>
          </div>

          {/* Complaint List for Department */}
          <div className="surface bordered rounded-2xl p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display font-bold text-lg text-content flex items-center gap-2">
                <Building2 size={18} />
                <span>Department Grievance Queue ({complaints.length})</span>
              </h2>
            </div>

            {loading ? (
              <div className="py-12 text-center text-sm text-content-3">Loading department queue...</div>
            ) : complaints.length === 0 ? (
              <div className="py-12 text-center text-sm text-content-3">No active complaints found for this department.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b surface-2 text-content-3 uppercase font-bold text-[11px]">
                      <th className="py-3 px-4">Tracking Code</th>
                      <th className="py-3 px-4">Category</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Priority</th>
                      <th className="py-3 px-4">District / Ward</th>
                      <th className="py-3 px-4">Assigned Officer</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {complaints.map(c => (
                      <tr key={c.id} className="hover:surface-2 transition-colors">
                        <td className="py-3 px-4 font-mono font-bold text-content">{c.id}</td>
                        <td className="py-3 px-4 text-content-2">{c.category}</td>
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded-full font-bold text-[11px] uppercase surface-2 bordered">
                            {statusLabel(t, c.status)}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-semibold text-content">{c.priority}</td>
                        <td className="py-3 px-4 text-content-3">{c.district || 'Unassigned'} / Ward {c.ward || '—'}</td>
                        <td className="py-3 px-4 text-content-2 font-medium">
                          {c.assignedOfficerId || c.assignedOfficerName ? (
                            <span className="flex items-center gap-1.5 font-semibold text-content">
                              <UserCheck size={13} className="text-success shrink-0" />
                              <span>{formatOfficerWithEmpId(c.assignedOfficerName || 'Assigned Officer')}</span>
                            </span>
                          ) : (
                            <span className="text-warning font-semibold">Unassigned</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </StaffShell>
    </RequireRole>
  );
}
