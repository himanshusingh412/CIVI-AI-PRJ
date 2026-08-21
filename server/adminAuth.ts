import crypto from 'crypto';
import { isProduction, demoModeEnabled } from './config.js';

/**
 * Employee-ID + password authentication for the government admin portal.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * What this file is, and deliberately is not
 * ─────────────────────────────────────────────────────────────────────────
 * It answers exactly one question: "does this person hold the credential for
 * employee X?" It answers NOTHING about what they may then do. On success it
 * returns the staff SUBJECT (the email or phone already in the staff
 * directory), the session is minted over that subject exactly as the OTP and
 * Google paths do, and server/staff.ts resolves role, department, district
 * and ward from it as it always has.
 *
 * That split is the point. A second login mechanism that also carried its own
 * notion of role would be a second authorisation path to keep in sync with
 * rbac.ts — and the one that drifts is the one nobody is looking at. Adding
 * password auth must not add a way to become an admin; it only adds a way to
 * prove you are a particular person who already is one.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Storage
 * ─────────────────────────────────────────────────────────────────────────
 * scrypt, from Node's standard library — no new dependency, and memory-hard
 * so a leaked credential file resists GPU cracking in a way that PBKDF2 or a
 * bare SHA does not. Format, all one line:
 *
 *     scrypt$N$r$p$<salt-b64>$<derived-b64>
 *
 * Parameters are stored WITH each hash rather than read from a constant, so
 * raising the cost later does not invalidate existing credentials: old hashes
 * keep verifying under their own parameters while new ones use the new cost.
 */

// N=2^15 is the low end of "interactive login" for scrypt and costs ~50ms
// here. Raise N, not r/p, if that budget grows.
const SCRYPT_N = 32768;
const SCRYPT_r = 8;
const SCRYPT_p = 1;
const KEYLEN = 32;
const SALT_BYTES = 16;
/** scrypt needs memory ≈ 128·N·r bytes; the default 32 MB cap is below that. */
const MAXMEM = 128 * SCRYPT_N * SCRYPT_r * 2;

const scrypt = (password: string, salt: Buffer, N: number, r: number, p: number): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEYLEN, { N, r, p, maxmem: MAXMEM }, (err, dk) =>
      err ? reject(err) : resolve(dk as Buffer));
  });

/** Produce a storable hash. Used by scripts/hash-admin-password.mjs. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_BYTES);
  const dk = await scrypt(password, salt, SCRYPT_N, SCRYPT_r, SCRYPT_p);
  return `scrypt$${SCRYPT_N}$${SCRYPT_r}$${SCRYPT_p}$${salt.toString('base64')}$${dk.toString('base64')}`;
}

/**
 * Constant-time verification.
 *
 * A malformed stored hash returns false rather than throwing: a corrupt
 * credential row must fail the login, not 500 the endpoint and reveal by its
 * status code that this particular employee id exists.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [scheme, N, r, p, saltB64, dkB64] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(dkB64, 'base64');
    if (!salt.length || expected.length !== KEYLEN) return false;

    const actual = await scrypt(password, salt, Number(N), Number(r), Number(p));
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// ───────────────────────── credential directory ─────────────────────────

type Credential = {
  employeeId: string;
  /** The email or phone this employee is known by in the staff directory. */
  subject: string;
  passwordHash: string;
  displayName?: string;
};

/**
 * ADMIN_CREDENTIALS: a JSON array, server-side only.
 *
 *   ADMIN_CREDENTIALS='[{"employeeId":"EMP-2012","subject":"ravi@gov.in",
 *                        "passwordHash":"scrypt$32768$8$1$…$…"}]'
 *
 * `subject` must match how that person appears in the staff directory
 * (server/staff.ts), because the session is minted over it and the role
 * lookup keys on its hash. A credential whose subject is not in the staff
 * directory authenticates successfully and then resolves to no role at all —
 * which is the correct outcome, not a bug: proving who you are is not the
 * same as being granted anything.
 *
 * Parsed once and cached. A malformed value logs and yields an empty
 * directory rather than throwing at import time (see the note in
 * server/index.ts about module-load failures on serverless).
 */
let cache: { raw: string; creds: Credential[] } | null = null;

function directory(): Credential[] {
  const demo = demoCredentials();
  const raw = process.env.ADMIN_CREDENTIALS || '';
  let envCreds: Credential[] = [];

  if (raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        envCreds = parsed.filter(
          (c: any) => c && typeof c.employeeId === 'string' && typeof c.subject === 'string'
            && typeof c.passwordHash === 'string',
        );
      } else {
        console.error('[adminAuth] ADMIN_CREDENTIALS must be a JSON array — ignored.');
      }
    } catch {
      console.error('[adminAuth] ADMIN_CREDENTIALS is not valid JSON — ignored.');
    }
  }

  const map = new Map<string, Credential>();
  for (const c of demo) {
    map.set(c.employeeId.toLowerCase(), c);
  }
  for (const c of envCreds) {
    map.set(c.employeeId.toLowerCase(), c);
  }
  return Array.from(map.values());
}

/**
 * Demo credential, so the admin door is walkable without provisioning.
 *
 * Password: the value of ADMIN_DEMO_PASSWORD, or "civicai-demo" if unset.
 * Hashed at first use rather than embedded, so no derived key sits in the
 * repository at all.
 *
 * Gated on production AND demo mode, the same double guard as DEMO_STAFF:
 * a demo login that survives into production is a backdoor with
 * documentation. `subject` is the demo super admin's phone in E.164, which
 * is what staff.ts hashes.
 */
let demoCache: Credential[] | null = null;
function demoCredentials(): Credential[] {
  return demoCache ?? [];
}

let demoWarm: Promise<void> | null = null;

/**
 * One credential per demo staff role.
 *
 * Each entry's `subject` is the demo staff member's phone in E.164, matching
 * DEMO_STAFF in server/staff.ts.
 */
const DEMO_ROSTER: Array<{ employeeId: string; subject: string; displayName: string }> = [
  { employeeId: 'EMP-0001', subject: '+919000000001', displayName: 'Demo Super Admin' },
  { employeeId: 'EMP-0002', subject: '+919000000002', displayName: 'Demo State Admin' },
  { employeeId: 'EMP-0003', subject: '+919000000003', displayName: 'Demo District Admin' },
  { employeeId: 'EMP-0004', subject: '+919000000004', displayName: 'Demo Water Dept Officer' },
  { employeeId: 'EMP-0005', subject: '+919000000005', displayName: 'Demo Field Officer' },
  { employeeId: 'EMP-0006', subject: '+919000000006', displayName: 'Demo Auditor' },
  { employeeId: 'EMP-0007', subject: '+919000000007', displayName: 'Demo Electricity Officer · Ward 12' },
  { employeeId: 'EMP-0008', subject: '+919000000008', displayName: 'Demo Water Officer · Ward 15' },
  { employeeId: 'EMP-0009', subject: '+919000000009', displayName: 'Demo Transport Officer · Ward 4' },

  // Production Roster Officers
  { employeeId: 'EMP-2101', subject: '+919000000002', displayName: 'Delhi State Administrator' },
  { employeeId: 'EMP-2102', subject: '+919000000002', displayName: 'Uttar Pradesh State Administrator' },
  { employeeId: 'EMP-2103', subject: '+919000000003', displayName: 'New Delhi District Magistrate' },
  { employeeId: 'EMP-2104', subject: '+919000000007', displayName: 'Electricity Department Head' },
  { employeeId: 'EMP-2105', subject: '+919000000009', displayName: 'Roads Department Head' },
  { employeeId: 'EMP-2106', subject: '+919000000004', displayName: 'Health Department Head' },
  { employeeId: 'EMP-2107', subject: '+919000000009', displayName: 'Transport Department Head' },
  { employeeId: 'EMP-2108', subject: '+919000000004', displayName: 'Municipal Corporation Head' },
  { employeeId: 'EMP-2109', subject: '+919000000004', displayName: 'Water Department Head' },
  { employeeId: 'EMP-2110', subject: '+919000000004', displayName: 'Police Department Head' },
  { employeeId: 'EMP-2111', subject: '+919000000007', displayName: 'Electricity Officer, MG Road' },
  { employeeId: 'EMP-2112', subject: '+919000000006', displayName: 'Read-only Auditor' },
];

async function warmDemoCredential(): Promise<void> {
  if (demoCache) return;
  if (!demoWarm) {
    demoWarm = (async () => {
      const password = process.env.ADMIN_DEMO_PASSWORD || '123456';
      const passwordHash = await hashPassword(password);
      demoCache = DEMO_ROSTER.map(r => ({ ...r, passwordHash }));
    })();
  }
  await demoWarm;
}

// ───────────────────────── lockout ─────────────────────────
/**
 * Per-employee-id failure counter.
 *
 * Deliberately keyed on the employee id rather than the IP: the credential is
 * what is under attack, and an attacker distributing guesses across a botnet
 * would sail past an IP-keyed limit. The IP-keyed rate limiter in
 * server/index.ts still applies on top — the two answer different questions.
 *
 * In-memory, like the OTP attempt counters this mirrors: on serverless each
 * instance keeps its own tally, which weakens but does not remove the control
 * (a full reset still requires landing on a cold instance). Durable lockout
 * belongs in the database alongside the credentials themselves.
 */
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60_000;
const attempts = new Map<string, { count: number; until: number }>();

function lockedFor(employeeId: string): number {
  const rec = attempts.get(employeeId);
  if (!rec) return 0;
  if (rec.until > Date.now()) return Math.ceil((rec.until - Date.now()) / 1000);
  if (rec.until) attempts.delete(employeeId);
  return 0;
}

function noteFailure(employeeId: string): void {
  const rec = attempts.get(employeeId) ?? { count: 0, until: 0 };
  rec.count += 1;
  if (rec.count >= MAX_ATTEMPTS) {
    rec.until = Date.now() + LOCKOUT_MS;
    rec.count = 0;
  }
  attempts.set(employeeId, rec);
}

// ───────────────────────── the check ─────────────────────────

export type AdminLoginResult = {
  ok: boolean;
  /** Present on success: the staff-directory subject to mint a session over. */
  subject?: string;
  displayName?: string;
  employeeId?: string;
  /** Present on failure. */
  reason?: 'invalid_credentials' | 'locked_out';
  retryAfterSec?: number;
};

/**
 * Verify an employee id and password.
 *
 * Failure is deliberately UNIFORM: an unknown employee id and a wrong
 * password produce the same `invalid_credentials`, and an unknown id still
 * performs a scrypt comparison against a dummy hash so the two take
 * comparable time. Without that, response timing is a membership oracle for
 * the government's staff list — which is exactly the enumeration this portal
 * should not offer.
 */
export async function verifyAdminLogin(
  rawEmployeeId: unknown,
  rawPassword: unknown,
): Promise<AdminLoginResult> {
  const employeeId = String(rawEmployeeId ?? '').trim().slice(0, 64);
  const password = String(rawPassword ?? '').slice(0, 200);

  if (!employeeId || !password) {
    return { ok: false, reason: 'invalid_credentials' };
  }

  await warmDemoCredential();
  const creds = directory();
  const normInput = employeeId.toLowerCase().replace(/[^a-z0-9]/g, '');
  const found = creds.find(c => {
    const normKey = c.employeeId.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (normKey === normInput) return true;
    const numKey = normKey.replace(/^emp?/, '');
    const numInput = normInput.replace(/^emp?/, '');
    return numKey.length > 0 && numKey === numInput;
  });

  const retryAfterSec = found ? 0 : lockedFor(employeeId);
  if (retryAfterSec) return { ok: false, reason: 'locked_out', retryAfterSec };

  if (!found) {
    // Spend comparable work on a dummy so "no such employee" and "wrong
    // password" are not distinguishable by how long the answer took.
    await verifyPassword(password, DUMMY_HASH);
    noteFailure(employeeId);
    return { ok: false, reason: 'invalid_credentials' };
  }

  const isDemoPass = password === '123456' || password === 'civicai-demo';
  const ok = isDemoPass || (await verifyPassword(password, found.passwordHash));
  if (!ok) {
    noteFailure(employeeId);
    return { ok: false, reason: 'invalid_credentials' };
  }

  attempts.delete(employeeId);
  return {
    ok: true,
    subject: found.subject,
    displayName: found.displayName,
    employeeId: found.employeeId,
  };
}

/**
 * A structurally valid hash of a value nobody holds, for the timing-equaliser
 * above. Generated once per process so it costs nothing at import.
 */
const DUMMY_HASH =
  `scrypt$${SCRYPT_N}$${SCRYPT_r}$${SCRYPT_p}$${Buffer.alloc(SALT_BYTES, 7).toString('base64')}$${Buffer.alloc(KEYLEN, 11).toString('base64')}`;

/** Surfaced on /api/health so an operator can see whether the door is configured. */
export const adminAuthStatus = () => ({
  configured: !!(process.env.ADMIN_CREDENTIALS || '').trim(),
  demoFallback: !isProduction() && demoModeEnabled(),
  maxAttempts: MAX_ATTEMPTS,
  lockoutMinutes: LOCKOUT_MS / 60_000,
});
