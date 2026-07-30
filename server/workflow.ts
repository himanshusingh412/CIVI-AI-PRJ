import type { Permission, Role } from './rbac.js';

/**
 * Complaint lifecycle as an explicit state machine.
 *
 * Encoding transitions as data rather than scattered `if (status === ...)`
 * checks means an invalid jump — say Submitted straight to Closed, skipping
 * citizen verification — is impossible by construction rather than by
 * everyone remembering the rules.
 *
 * Each transition also declares which permission it needs and which roles may
 * perform it, so the workflow and the authorisation model stay in one place.
 */

export const STATUSES = [
  'submitted',
  'ai_verification',
  'department_assigned',
  'officer_assigned',
  'investigation_started',
  'field_visit_scheduled',
  'evidence_uploaded',
  'work_in_progress',
  'resolved',
  'citizen_verification',
  'closed',
  'reopened',
  'rejected_spam',
  'merged',
] as const;

export type Status = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<Status, string> = {
  submitted: 'Submitted',
  ai_verification: 'AI Verification',
  department_assigned: 'Department Assigned',
  officer_assigned: 'Officer Assigned',
  investigation_started: 'Investigation Started',
  field_visit_scheduled: 'Field Visit Scheduled',
  evidence_uploaded: 'Evidence Uploaded',
  work_in_progress: 'Work In Progress',
  resolved: 'Resolved',
  citizen_verification: 'Citizen Verification',
  closed: 'Closed',
  reopened: 'Reopened',
  rejected_spam: 'Rejected (Spam)',
  merged: 'Merged',
};

/** Progress shown to the citizen. Terminal/exception states are explicit. */
export const STATUS_PROGRESS: Record<Status, number> = {
  submitted: 5,
  ai_verification: 12,
  department_assigned: 22,
  officer_assigned: 32,
  investigation_started: 45,
  field_visit_scheduled: 55,
  evidence_uploaded: 68,
  work_in_progress: 80,
  resolved: 92,
  citizen_verification: 96,
  closed: 100,
  reopened: 45,
  rejected_spam: 100,
  merged: 100,
};

type Transition = {
  to: Status;
  permission: Permission;
  /** Empty means "any role holding the permission". */
  roles?: Role[];
  label: string;
};

const T = (to: Status, permission: Permission, label: string, roles?: Role[]): Transition =>
  ({ to, permission, label, roles });

export const TRANSITIONS: Record<Status, Transition[]> = {
  submitted: [
    T('ai_verification', 'complaint:update_status', 'Run AI verification'),
    T('rejected_spam', 'complaint:update_status', 'Reject as spam', ['super_admin', 'state_admin', 'district_admin']),
    T('merged', 'complaint:merge', 'Merge into duplicate'),
  ],
  ai_verification: [
    T('department_assigned', 'complaint:reassign_department', 'Assign department'),
    T('rejected_spam', 'complaint:update_status', 'Reject as spam', ['super_admin', 'state_admin', 'district_admin']),
    T('merged', 'complaint:merge', 'Merge into duplicate'),
  ],
  department_assigned: [
    T('officer_assigned', 'complaint:assign', 'Assign officer'),
    T('department_assigned', 'complaint:reassign_department', 'Reassign department'),
  ],
  officer_assigned: [
    T('investigation_started', 'complaint:update_status', 'Start investigation'),
    T('officer_assigned', 'complaint:assign', 'Reassign officer'),
  ],
  investigation_started: [
    T('field_visit_scheduled', 'complaint:update_status', 'Schedule field visit'),
    T('work_in_progress', 'complaint:update_status', 'Begin work'),
  ],
  field_visit_scheduled: [
    T('evidence_uploaded', 'complaint:upload', 'Upload evidence'),
    T('work_in_progress', 'complaint:update_status', 'Begin work'),
  ],
  evidence_uploaded: [
    T('work_in_progress', 'complaint:update_status', 'Begin work'),
  ],
  work_in_progress: [
    T('resolved', 'complaint:update_status', 'Mark resolved'),
  ],
  // Closure is gated behind citizen verification — an officer cannot
  // unilaterally declare a case finished.
  resolved: [
    T('citizen_verification', 'complaint:update_status', 'Send for citizen verification'),
  ],
  citizen_verification: [
    T('closed', 'complaint:close', 'Close complaint'),
    T('reopened', 'complaint:reopen', 'Citizen reports unresolved'),
  ],
  closed: [
    T('reopened', 'complaint:reopen', 'Reopen complaint'),
  ],
  reopened: [
    T('officer_assigned', 'complaint:assign', 'Reassign officer'),
    T('work_in_progress', 'complaint:update_status', 'Resume work'),
  ],
  rejected_spam: [
    T('submitted', 'complaint:reopen', 'Restore (false positive)', ['super_admin', 'state_admin']),
  ],
  merged: [],
};

export const isTerminal = (s: Status): boolean => TRANSITIONS[s]?.length === 0;

/** Transitions this role could perform from here (ignoring record scope). */
export function allowedTransitions(from: Status, role: Role): Transition[] {
  return (TRANSITIONS[from] ?? []).filter(t => !t.roles || t.roles.includes(role));
}

export function canTransition(
  from: Status,
  to: Status,
  role: Role,
): { ok: true; permission: Permission; reason?: undefined } | { ok: false; permission?: undefined; reason: string } {
  const options = TRANSITIONS[from] ?? [];
  const match = options.find(t => t.to === to);

  if (!match) {
    const valid = options.map(o => o.to).join(', ') || 'none (terminal state)';
    return { ok: false, reason: `Cannot move from "${STATUS_LABELS[from]}" to "${STATUS_LABELS[to]}". Valid next: ${valid}.` };
  }
  if (match.roles && !match.roles.includes(role)) {
    return { ok: false, reason: `Your role cannot perform "${match.label}".` };
  }
  return { ok: true, permission: match.permission };
}

/** SLA hours per priority — drives the deadline and escalation clock. */
export const SLA_HOURS: Record<'Critical' | 'High' | 'Medium' | 'Low', number> = {
  Critical: 6,
  High: 24,
  Medium: 48,
  Low: 96,
};
