import { apiGet, apiPost, isAuthError, type AuthError } from './authService';

/**
 * Typed client for the admin API.
 *
 * The server is the authority on permissions — everything here is for
 * *rendering* decisions only (hiding a button the user can't use). Never
 * treat these values as a security boundary; the API re-checks every call.
 */

export type Role =
  | 'super_admin' | 'state_admin' | 'district_admin'
  | 'department_officer' | 'area_officer' | 'field_officer' | 'auditor';

export type Permission = string;

export type Scope = {
  state?: string;
  district?: string;
  department?: string;
  officerId?: string;
};

export type Principal = {
  id: string;
  role: Role;
  scope: Scope;
  displayName: string;
};

export type AssignmentRecord = {
  officerId: string;
  officerName: string;
  employeeId?: string;
  department?: string;
  district?: string;
  ward?: string;
  assignedById: string;
  assignedByName: string;
  assignedByRole: string;
  assignedAt: string;
  unassignedAt?: string;
  reason?: string;
  isCurrent: boolean;
};

export type Transition = { to: string; label: string; toLabel: string };

export type AdminComplaint = {
  id: string;
  createdAt: string;
  updatedAt: string;
  citizenName: string;
  citizenPhone: string;
  category: string;
  description: string;
  state: string;
  district: string;
  /**
   * Local area. Present on the server record and in the API projection but
   * absent from this type until now — which meant the assignment UI could not
   * narrow the officer dropdown by ward, the very dimension that makes area
   * officers distinct in the first place.
   */
  ward?: string;
  department?: string;
  assignedOfficerId?: string;
  assignedOfficerName?: string;

  /**
   * The current assignment record. Distinct from assignedOfficerName above,
   * which says only WHO holds the complaint — this also says who handed it
   * over and when, which is what makes an assignment auditable rather than
   * merely asserted. Null until a complaint has been assigned to anyone.
   */
  assignment?: AssignmentRecord | null;
  /** Every assignment this complaint has had, oldest first. */
  assignmentHistory?: AssignmentRecord[];

  status: string;
  statusLabel: string;
  progress: number;
  isTerminal: boolean;
  priority: 'Critical' | 'High' | 'Medium' | 'Low';
  escalationLevel: number;
  slaDeadline: string;
  lat?: number;
  lng?: number;
  timeline: { at: string; status: string; statusLabel: string; actorName: string; note?: string; isPublic: boolean }[];
  internalNotes: { at: string; authorName: string; body: string }[];
  publicUpdates: { at: string; body: string }[];
  attachments: { id: string; kind: string; filename: string; key: string; sizeBytes: number; uploadedAt: string }[];
  availableTransitions: Transition[];
};

export type Analytics = {
  ok: true;
  scope: Scope;
  totals: {
    total: number; active: number; pending: number; resolved: number;
    escalated: number; overdue: number; today: number;
  };
  avgResolutionHours: number;
  satisfaction: number | null;
  byDepartment: Record<string, number>;
  byDistrict: Record<string, number>;
  byState: Record<string, number>;
  byPriority: Record<string, number>;
  byStatus: Record<string, number>;
};

export type AuditEntry = {
  seq: number; id: string; at: string;
  actorId: string; actorRole: string;
  action: string; targetType: string; targetId: string;
  detail?: Record<string, unknown>;
  hash: string;
};

export type MeResponse = {
  ok: true;
  principal: Principal;
  permissions: Permission[];
  roles: Role[];
  /** Where this principal belongs, decided server-side. */
  homeRoute: string;
  store: { backend: string; durable: boolean; warning: string };
};

/**
 * Role impersonation via the `x-demo-role` header has been REMOVED.
 *
 * It was gated to non-production, so it was never exploitable in a real
 * deployment — but a header that changes your role is the exact shape of the
 * vulnerability this system exists to avoid, and its presence meant every
 * reading of the authorisation code had to carry an "except in development"
 * caveat. Roles are now data (server/staff.ts) and every role has a real
 * account you can actually sign into, so nothing was lost by deleting it.
 */
async function adminFetch<T>(path: string, init?: RequestInit): Promise<T | AuthError> {
  try {
    const csrf = document.cookie.match(/(?:^|; )civicai_csrf=([^;]*)/);
    const res = await fetch(path, {
      ...init,
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        ...(csrf ? { 'x-csrf-token': decodeURIComponent(csrf[1]) } : {}),
        ...(init?.headers as Record<string, string> | undefined),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        error: data.error || 'request_failed',
        message: data.message || 'Something went wrong. Please try again.',
      };
    }
    return data as T;
  } catch {
    return { ok: false, error: 'network', message: 'Cannot reach the server.' };
  }
}

export const fetchMe = () => adminFetch<MeResponse>('/api/admin/me');

export const fetchComplaints = (filters: Record<string, string> = {}) => {
  const qs = new URLSearchParams(
    Object.entries(filters).filter(([, v]) => v && v !== 'all') as [string, string][],
  ).toString();
  return adminFetch<{ ok: true; total: number; complaints: AdminComplaint[] }>(
    `/api/admin/complaints${qs ? `?${qs}` : ''}`,
  );
};

export const fetchComplaint = (id: string) =>
  adminFetch<{ ok: true; complaint: AdminComplaint }>(`/api/admin/complaints/${encodeURIComponent(id)}`);

export const changeStatus = (id: string, status: string, note?: string) =>
  adminFetch<{ ok: true; complaint: AdminComplaint }>(
    `/api/admin/complaints/${encodeURIComponent(id)}/status`,
    { method: 'POST', body: JSON.stringify({ status, note }) },
  );

/**
 * Assign or reassign a complaint.
 *
 * `officerName` is deliberately NOT a parameter any more. It used to be sent
 * alongside the id and stored verbatim, which meant the officer's displayed
 * name was whatever this browser said it was. The server now reads the name
 * from the officer roster; sending one would be ignored, so the signature
 * stops offering it. `reason` is free text recorded on a reassignment.
 */
export const assignOfficer = (id: string, officerId: string, reason?: string) =>
  adminFetch<{ ok: true; complaint: AdminComplaint }>(
    `/api/admin/complaints/${encodeURIComponent(id)}/assign`,
    { method: 'POST', body: JSON.stringify({ officerId, reason }) },
  );

/**
 * A note that is not a status change. `visibility` defaults to internal on
 * the server too - the safe value is the one you get by saying nothing,
 * because getting it backwards publishes an officer's private working note
 * to the complainant.
 */
export const addNote = (id: string, body: string, visibility: 'internal' | 'public' = 'internal') =>
  adminFetch<{ ok: true; complaint: AdminComplaint }>(
    `/api/admin/complaints/${encodeURIComponent(id)}/note`,
    { method: 'POST', body: JSON.stringify({ body, visibility }) },
  );

export const fetchAnalytics = () => adminFetch<Analytics>('/api/admin/analytics');

export const fetchAudit = (limit = 100) =>
  adminFetch<{ ok: true; entries: AuditEntry[]; chain: { intact: boolean; brokenAtSeq?: number } }>(
    `/api/admin/audit?limit=${limit}`,
  );

export { isAuthError, apiGet, apiPost };

/**
 * Per-department counters for the admin overview.
 *
 * `department` is the STABLE stored value, or null for complaints not yet
 * routed anywhere — the caller translates it for display via
 * i18n/labels.departmentLabel rather than the server sending prose. Null is
 * kept rather than dropped because unrouted complaints are precisely the
 * ones that need triage.
 */
export type DepartmentSummary = {
  department: string | null;
  total: number;
  new: number;
  unassigned: number;
  assigned: number;
  investigating: number;
  inProgress: number;
  resolved: number;
  escalated: number;
  overdue: number;
};

export const fetchDepartments = () =>
  adminFetch<{ ok: true; total: number; departments: DepartmentSummary[] }>(
    '/api/admin/departments',
  );

export const fetchDepartmentDetail = (id: string) =>
  adminFetch<{ ok: true; summary: DepartmentSummary; complaints: AdminComplaint[] }>(
    `/api/admin/departments/${encodeURIComponent(id)}`,
  );


/** Officers this admin may assign to, optionally narrowed to one complaint's area. */
export type AssignableOfficer = {
  id: string;
  name: string;
  employeeId?: string;
  department?: string;
  district?: string;
  ward?: string;
};

export const fetchOfficers = (filters: Record<string, string | undefined> = {}) => {
  const qs = new URLSearchParams(
    Object.entries(filters).filter(([, v]) => !!v) as [string, string][],
  ).toString();
  return adminFetch<{ ok: true; count: number; officers: AssignableOfficer[] }>(
    `/api/admin/officers${qs ? `?${qs}` : ''}`,
  );
};
