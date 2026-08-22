import type { Complaint } from '../types';
import { formatOfficerWithEmpId } from './officerUtils';

/**
 * Translate a server complaint into the shape the UI was built around.
 */
// ... (rest of code stays)
const IN_PROGRESS = new Set([
  'officer_assigned', 'investigation_started', 'field_visit_scheduled',
  'evidence_uploaded', 'work_in_progress', 'reopened',
]);
const DONE = new Set(['resolved', 'citizen_verification', 'closed']);

export function toUiStatus(serverStatus: string): Complaint['status'] {
  const s = String(serverStatus ?? '').toLowerCase();
  if (IN_PROGRESS.has(s)) return 'In Progress';
  if (DONE.has(s)) return 'Resolved';
  if (s === 'rejected') return 'Resolved';
  return 'Pending';
}

export function toServerStatus(ui: Complaint['status']): string {
  switch (ui) {
    case 'In Progress': return 'work_in_progress';
    case 'Resolved': return 'resolved';
    case 'Emergency': return 'submitted';
    default: return 'submitted';
  }
}

interface ServerComplaint {
  id: string;
  createdAt?: string;
  updatedAt?: string;
  category?: string;
  department?: string;
  description?: string;
  status?: string;
  priority?: string;
  escalationLevel?: number;
  slaDeadline?: string;
  assignedOfficerName?: string;
  citizenRating?: number;
  lat?: number | null;
  lng?: number | null;
  attachments?: { url?: string }[];
}

const FALLBACK = { lat: 28.6139, lng: 77.209 };

export function toUiComplaint(s: ServerComplaint): Complaint {
  const created = s.createdAt ? new Date(s.createdAt) : new Date();
  const rawOfficer = s.assignedOfficerName ?? 'Unassigned';
  const formattedOfficer = formatOfficerWithEmpId(rawOfficer);

  return {
    id: s.id,
    category: s.category ?? 'General',
    department: s.department ?? undefined,
    description: s.description ?? '',
    status: toUiStatus(s.status ?? 'submitted'),
    priority: (['Low', 'Medium', 'High', 'Critical'].includes(String(s.priority))
      ? s.priority
      : 'Medium') as Complaint['priority'],
    escalated: (s.escalationLevel ?? 0) > 0,
    officer: formattedOfficer,
    date: created.toLocaleDateString('en-GB'),
    deadline: s.slaDeadline ? new Date(s.slaDeadline).getTime() : created.getTime() + 48 * 3600_000,
    timestamp: created.getTime(),
    lat: typeof s.lat === 'number' ? s.lat : FALLBACK.lat,
    lng: typeof s.lng === 'number' ? s.lng : FALLBACK.lng,
    rating: s.citizenRating ?? undefined,
    photoUrl: s.attachments?.[0]?.url,
  };
}
