import crypto from 'crypto';
import type { Principal } from './rbac.js';

/**
 * Append-only audit trail.
 *
 * The spec requires entries be neither editable nor deletable. In-process
 * that's enforced two ways:
 *   - the module exposes no update/delete function at all, and
 *   - each entry is hash-chained to its predecessor, so tampering with an
 *     older record invalidates every hash after it and `verifyChain()` fails.
 *
 * Hash chaining is what makes this meaningfully tamper-evident rather than
 * just "we didn't write a delete endpoint" — an attacker with memory or DB
 * write access can still alter rows, but they can no longer do so silently.
 */

export type AuditAction =
  | 'auth:login' | 'auth:logout' | 'auth:failed'
  | 'complaint:create' | 'complaint:status_change' | 'complaint:assign'
  | 'complaint:reassign_department' | 'complaint:escalate' | 'complaint:merge'
  | 'complaint:note' | 'complaint:upload' | 'complaint:reopen' | 'complaint:close'
  | 'access:denied' | 'export:data' | 'user:manage';

export type AuditEntry = {
  seq: number;
  id: string;
  at: string;              // ISO timestamp
  actorId: string;
  actorRole: string;
  action: AuditAction;
  targetType: 'complaint' | 'user' | 'session' | 'system';
  targetId: string;
  /** Before/after for mutations. Never store secrets or raw contact details. */
  detail?: Record<string, unknown>;
  ip?: string;
  prevHash: string;
  hash: string;
};

const GENESIS = '0'.repeat(64);
const entries: AuditEntry[] = [];

const hashOf = (e: Omit<AuditEntry, 'hash'>): string =>
  crypto.createHash('sha256')
    .update(`${e.seq}|${e.id}|${e.at}|${e.actorId}|${e.action}|${e.targetType}|${e.targetId}|${JSON.stringify(e.detail ?? {})}|${e.prevHash}`)
    .digest('hex');

/**
 * Records an action. There is intentionally no counterpart to remove or
 * amend an entry.
 */
export function record(params: {
  actor: Principal | { id: string; role: string };
  action: AuditAction;
  targetType: AuditEntry['targetType'];
  targetId: string;
  detail?: Record<string, unknown>;
  ip?: string;
}): AuditEntry {
  const prev = entries[entries.length - 1];
  const base = {
    seq: entries.length + 1,
    id: crypto.randomBytes(8).toString('hex'),
    at: new Date().toISOString(),
    actorId: params.actor.id,
    actorRole: String(params.actor.role),
    action: params.action,
    targetType: params.targetType,
    targetId: params.targetId,
    detail: params.detail,
    ip: params.ip,
    prevHash: prev?.hash ?? GENESIS,
  };
  const entry: AuditEntry = { ...base, hash: hashOf(base) };
  entries.push(entry);
  return entry;
}

export type AuditQuery = {
  actorId?: string;
  action?: AuditAction;
  targetId?: string;
  since?: string;
  limit?: number;
};

export function query(q: AuditQuery = {}): AuditEntry[] {
  const limit = Math.min(Math.max(q.limit ?? 100, 1), 500);
  return entries
    .filter(e => (!q.actorId || e.actorId === q.actorId))
    .filter(e => (!q.action || e.action === q.action))
    .filter(e => (!q.targetId || e.targetId === q.targetId))
    .filter(e => (!q.since || e.at >= q.since))
    .slice(-limit)
    .reverse();
}

/** Recomputes the chain; returns the first index that fails, or null if intact. */
export function verifyChain(): { intact: true } | { intact: false; brokenAtSeq: number } {
  let prevHash = GENESIS;
  for (const e of entries) {
    const { hash, ...rest } = e;
    if (e.prevHash !== prevHash || hashOf(rest) !== hash) {
      return { intact: false, brokenAtSeq: e.seq };
    }
    prevHash = e.hash;
  }
  return { intact: true };
}

export const auditStats = () => ({
  entries: entries.length,
  chain: verifyChain(),
});
