import { isAuthError, type AuthError } from './authService';

/**
 * "Who am I, and where do I belong?" — answered by the server, always.
 *
 * The browser never derives its own role. It asks, and it follows the
 * `homeRoute` it is given. A client that ignores the answer and navigates
 * somewhere else simply arrives at a screen whose data endpoints refuse it,
 * because routing is convenience and authorisation is enforcement.
 */

export type StaffRole =
  | 'super_admin'
  | 'state_admin'
  | 'district_admin'
  | 'department_officer'
  | 'area_officer'
  | 'field_officer'
  | 'auditor';

export type IdentityRole = StaffRole | 'citizen';

export type Identity = {
  identifier: string;
  channel: 'phone' | 'google';
  isStaff: boolean;
  role: IdentityRole;
  displayName: string;
  homeRoute: string;
  permissions: string[];
  scope: Record<string, string | undefined>;
  grantSource?: string;
};

export async function fetchIdentity(signal?: AbortSignal): Promise<Identity | AuthError> {
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin', signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        error: data.error || 'request_failed',
        message: data.message || 'Could not load your account.',
      };
    }
    return data as Identity;
  } catch {
    return { ok: false, error: 'network', message: 'Could not reach CivicAI.' };
  }
}

/** Human labels. Kept beside the type so a new role fails to compile silently. */
export const ROLE_LABELS: Record<IdentityRole, string> = {
  citizen: 'Citizen',
  super_admin: 'Super Administrator',
  state_admin: 'State Administrator',
  district_admin: 'District Administrator',
  department_officer: 'Department Officer',
  area_officer: 'Area Officer',
  field_officer: 'Field Officer',
  auditor: 'Auditor',
};

export { isAuthError };
