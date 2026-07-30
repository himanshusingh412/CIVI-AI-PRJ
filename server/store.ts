import crypto from 'crypto';
import type { Status } from './workflow.js';
import { SLA_HOURS } from './workflow.js';

/**
 * Complaint store behind a narrow interface.
 *
 * The in-memory implementation is a development stand-in ONLY. It is
 * per-process, so on Vercel serverless two requests can hit different
 * instances and see different data, and everything is lost on restart.
 * Swapping in Postgres means implementing `ComplaintStore` and nothing above
 * this file changes.
 *
 * Deliberately NOT a real persistence layer pretending to be one — see
 * `storeStatus().durable`, which the admin UI surfaces as a warning banner.
 */

export type Priority = 'Critical' | 'High' | 'Medium' | 'Low';

export type TimelineEvent = {
  at: string;
  status: Status;
  actorId: string;
  actorName: string;
  note?: string;
  /** Shown to the citizen in tracking; internal notes are excluded. */
  isPublic: boolean;
};

export type Attachment = {
  id: string;
  kind: 'image' | 'video' | 'audio' | 'document';
  filename: string;
  /** Storage key, not a raw path — keeps the store backend-agnostic. */
  key: string;
  sizeBytes: number;
  uploadedBy: string;
  uploadedAt: string;
};

export type Complaint = {
  id: string;
  createdAt: string;
  updatedAt: string;

  citizenName: string;
  citizenPhone: string;
  citizenEmail?: string;

  category: string;
  aiCategory?: string;
  aiConfidence?: number;
  description: string;
  summary?: string;
  language?: string;

  state: string;
  district: string;
  ward?: string;
  lat?: number;
  lng?: number;

  department?: string;
  assignedOfficerId?: string;
  assignedOfficerName?: string;

  status: Status;
  priority: Priority;
  escalationLevel: number;
  slaDeadline: string;

  duplicateOfId?: string;
  mergedIds?: string[];

  attachments: Attachment[];
  timeline: TimelineEvent[];
  internalNotes: { at: string; authorId: string; authorName: string; body: string }[];
  publicUpdates: { at: string; body: string }[];

  aiSuggestedResolution?: string;
  expectedCompletion?: string;
  citizenRating?: number;
};

export interface ComplaintStore {
  list(): Promise<Complaint[]>;
  get(id: string): Promise<Complaint | null>;
  create(input: Omit<Complaint, 'id' | 'createdAt' | 'updatedAt' | 'timeline' | 'attachments' | 'internalNotes' | 'publicUpdates' | 'escalationLevel' | 'slaDeadline'> & Partial<Pick<Complaint, 'slaDeadline'>>): Promise<Complaint>;
  update(id: string, patch: Partial<Complaint>): Promise<Complaint | null>;
}

const slaFor = (priority: Priority, from = Date.now()): string =>
  new Date(from + SLA_HOURS[priority] * 3600_000).toISOString();

class MemoryComplaintStore implements ComplaintStore {
  private rows = new Map<string, Complaint>();

  async list() {
    return [...this.rows.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async get(id: string) {
    return this.rows.get(id) ?? null;
  }
  async create(input: any) {
    const now = new Date().toISOString();
    const seq = String(this.rows.size + 1).padStart(4, '0');
    const id = `CIV-${now.slice(0, 10).replace(/-/g, '')}-${seq}`;
    const row: Complaint = {
      escalationLevel: 0,
      attachments: [],
      timeline: [],
      internalNotes: [],
      publicUpdates: [],
      ...input,
      id,
      createdAt: now,
      updatedAt: now,
      slaDeadline: input.slaDeadline ?? slaFor(input.priority ?? 'Medium'),
    };
    this.rows.set(id, row);
    return row;
  }
  async update(id: string, patch: Partial<Complaint>) {
    const cur = this.rows.get(id);
    if (!cur) return null;
    const next = { ...cur, ...patch, id: cur.id, updatedAt: new Date().toISOString() };
    this.rows.set(id, next);
    return next;
  }
}

let active: ComplaintStore = new MemoryComplaintStore();
let backend: 'memory' | 'postgres' = 'memory';

/**
 * Proxy so modules can `import { store }` once at load time and still get the
 * Postgres implementation after async init swaps it in.
 */
export const store: ComplaintStore = {
  list: (...a) => active.list(...a),
  get: (...a) => active.get(...a),
  create: (...a) => active.create(...a),
  update: (...a) => active.update(...a),
};

/** Switches to Postgres when DATABASE_URL is configured and reachable. */
export async function initStore(): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  try {
    const pg = await import('./store.postgres.js');
    if (await pg.initPostgres()) {
      active = pg.postgresStore;
      backend = 'postgres';
    }
  } catch (err) {
    console.error('[store] Postgres init failed; staying on in-memory store.', err);
  }
}

export const storeStatus = () => ({
  backend,
  /** Surfaced in the UI so nobody mistakes this for production storage. */
  durable: backend === 'postgres',
  warning: backend === 'postgres'
    ? ''
    : 'In-memory store: data is lost on restart and is not shared across serverless instances. ' +
      'Set DATABASE_URL (Neon Postgres) to enable durable storage.',
});

// ───────────────────────── demo seed ─────────────────────────
/**
 * Seeds a spread of states/districts/departments/officers so RBAC scoping is
 * actually observable — with one row per jurisdiction you cannot tell
 * filtering from luck.
 */
export async function seedDemoData() {
  if ((await store.list()).length) return;

  const rows: Array<Partial<Complaint>> = [
    { citizenName: 'Ramesh Chandra', citizenPhone: '9876543210', category: 'Water Supply',
      description: 'No water supply for 3 days in Sector 14.', state: 'Delhi', district: 'New Delhi',
      department: 'Water Department', status: 'work_in_progress', priority: 'High',
      assignedOfficerId: 'off-1', assignedOfficerName: 'Suresh Kumar', lat: 28.6139, lng: 77.2090 },

    { citizenName: 'Anita Sharma', citizenPhone: '9812345678', category: 'Roads & Transport',
      description: 'Large pothole on MG Road causing accidents.', state: 'Delhi', district: 'South Delhi',
      department: 'Roads Department', status: 'officer_assigned', priority: 'Critical',
      assignedOfficerId: 'off-2', assignedOfficerName: 'Priya Sharma', lat: 28.5355, lng: 77.2100 },

    { citizenName: 'Mohammed Iqbal', citizenPhone: '9911223344', category: 'Sanitation',
      description: 'Garbage uncollected for a week near Park Street.', state: 'Maharashtra',
      district: 'Mumbai', department: 'Sanitation Department', status: 'resolved', priority: 'Medium',
      assignedOfficerId: 'off-3', assignedOfficerName: 'Amit Verma', lat: 19.0760, lng: 72.8777 },

    { citizenName: 'Lakshmi Nair', citizenPhone: '9800011122', category: 'Electricity',
      description: 'Frequent power cuts every evening.', state: 'Maharashtra', district: 'Pune',
      department: 'Electricity Board', status: 'submitted', priority: 'Medium', lat: 18.5204, lng: 73.8567 },

    { citizenName: 'Gurpreet Singh', citizenPhone: '9700088899', category: 'Law & Order',
      description: 'Streetlights out, unsafe at night near the bus depot.', state: 'Delhi',
      district: 'New Delhi', department: 'Police Department', status: 'department_assigned',
      priority: 'High', lat: 28.6280, lng: 77.2190 },
  ];

  for (const r of rows) {
    const created = await store.create(r as any);
    await store.update(created.id, {
      timeline: [{
        at: created.createdAt,
        status: created.status,
        actorId: 'system',
        actorName: 'System',
        note: 'Complaint received.',
        isPublic: true,
      }],
    });
  }
}

export const newId = () => crypto.randomBytes(6).toString('hex');
