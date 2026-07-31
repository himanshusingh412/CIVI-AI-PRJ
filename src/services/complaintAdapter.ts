import type { Complaint } from '../types';

/**
 * Translate a server complaint into the shape the UI was built around.
 *
 * These are two genuinely different models and always have been:
 *
 *            server                     UI
 *   status   14-state machine           4 buckets
 *   time     slaDeadline / createdAt    deadline / timestamp / date
 *   officer  assignedOfficerName        officer (required string)
 *
 * The right long-term fix is for the UI to adopt the 14-state model, since
 * collapsing it loses the distinction between "an officer is assigned" and
 * "someone is actually on site" — which is most of what a citizen wants to
 * know. That is a large change across a 2,300-line component, so this
 * adapter is the seam: one file that must be correct, rather than the two
 * models silently disagreeing at a hundred call sites.
 */

const IN_PROGRESS = new Set([
  'officer_assigned', 'investigation_started', 'field_visit_scheduled',
  'evidence_uploaded', 'work_in_progress', 'reopened',
]);
const DONE = new Set(['resolved', 'citizen_verification', 'closed']);

export function toUiStatus(serverStatus: string): Complaint['status'] {
  const s = String(serverStatus ?? '').toLowerCase();
  if (IN_PROGRESS.has(s)) return 'In Progress';
  if (DONE.has(s)) return 'Resolved';
  // KNOWN LOSS: 'rejected' is terminal but not resolved, and the UI's
  // four-bucket model cannot express it. It reads as Resolved until the UI
  // adopts the real state machine. Flagged rather than hidden.
  if (s === 'rejected') return 'Resolved';
  return 'Pending';
}

/** Reverse direction, for writes. Maps to the earliest matching server state. */
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

/** Delhi's centre — used only when a row genuinely has no coordinates, so
 *  the map does not throw. Never persisted back. */
const FALLBACK = { lat: 28.6139, lng: 77.209 };

export function toUiComplaint(s: ServerComplaint): Complaint {
  const created = s.createdAt ? new Date(s.createdAt) : new Date();
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
    officer: s.assignedOfficerName ?? 'Unassigned',
    date: created.toLocaleDateString('en-GB'),
    deadline: s.slaDeadline ? new Date(s.slaDeadline).getTime() : created.getTime() + 48 * 3600_000,
    timestamp: created.getTime(),
    lat: typeof s.lat === 'number' ? s.lat : FALLBACK.lat,
    lng: typeof s.lng === 'number' ? s.lng : FALLBACK.lng,
    rating: s.citizenRating ?? undefined,
    photoUrl: s.attachments?.[0]?.url,
  };
}
