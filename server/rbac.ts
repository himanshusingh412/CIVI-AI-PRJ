/**
 * Role-Based Access Control.
 *
 * Two independent questions are answered here, and conflating them is the
 * classic way RBAC goes wrong:
 *
 *   1. CAPABILITY — "may this role perform this action at all?"
 *   2. SCOPE      — "is this specific record inside their jurisdiction?"
 *
 * A District Admin has the `complaint:assign` capability, but only for
 * complaints in their own district. Checking capability alone would let them
 * reassign a complaint in another state; checking scope alone would let a
 * read-only auditor mutate records in their own district. Both must pass.
 *
 * All enforcement lives server-side. The client's role is used only to decide
 * what to *render* — never to decide what is *permitted*.
 */

export const ROLES = [
  'super_admin',
  'state_admin',
  'district_admin',
  'department_officer',
  'field_officer',
  'auditor',
] as const;

export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'complaint:read',
  'complaint:create',
  'complaint:update_status',
  'complaint:assign',
  'complaint:reassign_department',
  'complaint:escalate',
  'complaint:merge',
  'complaint:note',
  'complaint:upload',
  'complaint:reopen',
  'complaint:close',
  'analytics:read',
  'audit:read',
  'user:manage',
  'export:data',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const READ_ONLY: Permission[] = ['complaint:read', 'analytics:read', 'audit:read', 'export:data'];

/**
 * Capability matrix. Deliberately explicit rather than inherited — role
 * hierarchies that "extend" each other make it hard to answer "what can a
 * field officer actually do?" without tracing a chain.
 */
const CAPABILITIES: Record<Role, Permission[]> = {
  super_admin: [...PERMISSIONS],

  state_admin: [
    'complaint:read', 'complaint:create', 'complaint:update_status', 'complaint:assign',
    'complaint:reassign_department', 'complaint:escalate', 'complaint:merge',
    'complaint:note', 'complaint:upload', 'complaint:reopen', 'complaint:close',
    'analytics:read', 'audit:read', 'export:data',
  ],

  district_admin: [
    'complaint:read', 'complaint:create', 'complaint:update_status', 'complaint:assign',
    'complaint:reassign_department', 'complaint:escalate', 'complaint:merge',
    'complaint:note', 'complaint:upload', 'complaint:reopen',
    'analytics:read', 'export:data',
  ],

  department_officer: [
    'complaint:read', 'complaint:update_status', 'complaint:assign', 'complaint:escalate',
    'complaint:note', 'complaint:upload', 'analytics:read',
  ],

  // Field officers act on their own assignments only; they cannot hand work
  // to someone else or close a case (closure requires citizen verification).
  field_officer: [
    'complaint:read', 'complaint:update_status', 'complaint:note', 'complaint:upload',
  ],

  auditor: READ_ONLY,
};

/** A user's jurisdiction. `undefined` means "unrestricted at this level". */
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

/** Anything scope is evaluated against. */
export type ScopedRecord = {
  state?: string;
  district?: string;
  department?: string;
  assignedOfficerId?: string;
};

export const can = (principal: Principal, permission: Permission): boolean =>
  CAPABILITIES[principal.role]?.includes(permission) ?? false;

export const permissionsFor = (role: Role): Permission[] => [...(CAPABILITIES[role] ?? [])];

/**
 * Scope check. Each constraint present on the principal must match the
 * record. Absent constraints are wildcards, which is why super_admin (empty
 * scope) matches everything.
 *
 * Field officers are special-cased: their scope is the assignment itself, so
 * a complaint in their district that belongs to a colleague is still denied.
 */
export function inScope(principal: Principal, record: ScopedRecord): boolean {
  const { scope, role } = principal;

  if (scope.state && record.state !== scope.state) return false;
  if (scope.district && record.district !== scope.district) return false;
  if (scope.department && record.department !== scope.department) return false;

  if (role === 'field_officer') {
    if (!scope.officerId) return false; // misconfigured principal → deny
    if (record.assignedOfficerId !== scope.officerId) return false;
  }

  return true;
}

/** The check call sites should use: capability AND scope, never one alone. */
export function authorize(
  principal: Principal,
  permission: Permission,
  record?: ScopedRecord,
): { ok: true; reason?: undefined } | { ok: false; reason: 'forbidden_action' | 'out_of_scope' } {
  if (!can(principal, permission)) return { ok: false, reason: 'forbidden_action' };
  if (record && !inScope(principal, record)) return { ok: false, reason: 'out_of_scope' };
  return { ok: true };
}

/**
 * Narrows a list to what the principal may see. Used for list endpoints so
 * filtering happens in the data layer rather than being trusted to the UI.
 */
export function visibleTo<T extends ScopedRecord>(principal: Principal, records: T[]): T[] {
  if (!can(principal, 'complaint:read')) return [];
  return records.filter(r => inScope(principal, r));
}

/**
 * Field-level redaction. Citizen contact details are only visible to roles
 * that need them to actually do the work — auditors and analytics consumers
 * get masked values, satisfying data-minimisation.
 */
const CONTACT_VISIBLE: Role[] = ['super_admin', 'state_admin', 'district_admin', 'department_officer', 'field_officer'];

export const canSeeContactDetails = (principal: Principal): boolean =>
  CONTACT_VISIBLE.includes(principal.role);

export function maskPhone(phone: string): string {
  const d = String(phone || '').replace(/\D/g, '');
  return d.length < 4 ? '••••' : `••••••${d.slice(-4)}`;
}

export function maskName(name: string): string {
  const parts = String(name || '').trim().split(/\s+/);
  if (!parts[0]) return 'Anonymous';
  return parts
    .map((p, i) => (i === 0 ? p : `${p[0]}.`))
    .join(' ');
}
