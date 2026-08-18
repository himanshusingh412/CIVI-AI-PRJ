import express, { type Request, type Response } from 'express';
import crypto from 'node:crypto';
import {
  extractDocument, validateUpload, DOCUMENT_TYPES, DOCUMENT_LABELS,
  type DocumentType, type ExtractedFields,
} from './ocr.js';
import { verifyDocuments, type VerifiableDocument, type VerificationReport } from './verify.js';
import { digilockerStatus } from './digilocker.js';
import { modeOf, demoModeEnabled } from './config.js';
import { safeError } from './security.js';

/**
 * AI Document Verification - the citizen-facing API.
 *
 * =========================================================================
 * STORAGE POLICY - read this before adding a table
 * =========================================================================
 * Nothing here is written to the database. Not the file bytes, not the
 * extracted fields, not the report. A verification session lives in memory
 * for 30 minutes and is then gone.
 *
 * That is a deliberate choice, not an unfinished one. What passes through
 * this endpoint is the highest-sensitivity data in the product: a citizen's
 * identity number, date of birth, parents' names and home address, uploaded
 * at a moment when they have not applied for anything and may never apply.
 * Retaining it would mean the state holds a copy of someone's identity
 * documents because they once *considered* an application.
 *
 * The feature does not need retention to work. Verification is a
 * point-in-time check, the citizen sees the result immediately, and nothing
 * downstream consumes it.
 *
 * If retention is later required - an audit obligation, or resuming a
 * half-finished application - that is a POLICY decision needing a privacy
 * notice, a retention period, a deletion path and a lawful basis. It is not
 * a storage detail to be added quietly because a table would be convenient.
 *
 * Consequences, stated rather than discovered:
 *   - a session does not survive a server restart
 *   - on multi-instance serverless, requests must be sticky or the session
 *     appears to vanish. Move this to Redis before scaling horizontally.
 * =========================================================================
 */

export const documentsRouter = express.Router();

// ---------------------------- session store ----------------------------

export type SessionDocument = {
  id: string;
  label: string;
  documentType: DocumentType;
  fields: ExtractedFields;
  confidence: number;
  simulated: boolean;
  error?: string;
  source: 'upload' | 'digilocker';
  addedAt: string;
};

export type VerificationSession = {
  documents: SessionDocument[];
  report: VerificationReport | null;
  updatedAt: number;
  /** DigiLocker authorisation handle, when one is in progress. */
  digilockerSessionId?: string;
};

const SESSION_TTL_MS = 30 * 60_000;
export const MAX_DOCUMENTS = 6;
const sessions = new Map<string, VerificationSession>();

const sweep = setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [k, v] of sessions) if (v.updatedAt < cutoff) sessions.delete(k);
}, 60_000);
sweep.unref?.();

/**
 * Sessions are keyed on the signed-in subject's hash, which is derived from
 * the verified identity and never sent by the client as a parameter. Keying
 * on anything the browser supplies would let one person read another's
 * uploaded documents by guessing an id.
 */
export function keyFor(req: Request): string {
  const s = (req as any).session;
  return s?.subjectHash || crypto.createHash('sha256').update(String(s?.identifier ?? '')).digest('hex');
}

export function sessionFor(req: Request): VerificationSession {
  const key = keyFor(req);
  let s = sessions.get(key);
  if (!s) {
    s = { documents: [], report: null, updatedAt: Date.now() };
    sessions.set(key, s);
  }
  s.updatedAt = Date.now();
  return s;
}

/**
 * Clear the documents under comparison, WITHOUT revoking anything else.
 *
 * An earlier version deleted the whole session map entry, which also threw
 * away the DigiLocker authorisation handle — so "start over" silently
 * de-authorised the citizen and the next import failed with a 401 they had
 * no way to interpret. Clearing your working set is not the same act as
 * withdrawing consent, and the two must not share a code path.
 */
export function clearDocuments(req: Request): VerificationSession {
  const s = sessionFor(req);
  s.documents = [];
  s.report = null;
  return s;
}

/** Full teardown, including any authorisation handle. Used on sign-out. */
export function dropSession(req: Request): void {
  sessions.delete(keyFor(req));
}

/** Client-visible shape. Bytes are never included - they are never kept. */
export const publicDoc = (d: SessionDocument) => ({
  id: d.id,
  label: d.label,
  documentType: d.documentType,
  typeLabel: DOCUMENT_LABELS[d.documentType] ?? 'Document',
  fields: d.fields,
  confidence: d.confidence,
  simulated: d.simulated,
  error: d.error,
  source: d.source,
  addedAt: d.addedAt,
});

export const sessionPayload = (s: VerificationSession) => ({
  ok: true,
  documents: s.documents.map(publicDoc),
  report: s.report,
  limits: { maxDocuments: MAX_DOCUMENTS, expiresInMinutes: Math.round(SESSION_TTL_MS / 60_000) },
  digilocker: digilockerStatus(),
  ocrMode: modeOf('ocr'),
});

export function addDocument(s: VerificationSession, doc: SessionDocument): void {
  s.documents.push(doc);
  // Adding a document invalidates the previous report. Showing a stale
  // "verified" beside a newly added document would be actively misleading.
  s.report = null;
}

// ---------------------------- file sniffing ----------------------------

/**
 * Magic numbers. The client controls the filename and the Content-Type
 * header; it does not as easily control the first bytes. Mirrors media.ts,
 * extended with PDF because certificates are usually PDFs.
 */
function sniffDocument(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buf.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  return null;
}

/**
 * A filename is attacker-controlled text that gets echoed back into the UI.
 *
 * Built from escape sequences rather than literal characters so the pattern
 * stays readable in a diff and cannot be mangled by an editor that helpfully
 * strips what it thinks is whitespace.
 *
 * Covers C0 and C1 control ranges plus the bidirectional-override block. The
 * last one matters: U+202E turns the displayed filename "annexure-gpj.exe"
 * into something that reads as "annexure-exe.jpg", which is a real technique
 * for making a hostile attachment look benign in a list.
 *
 * The result is a LABEL only. It never touches a filesystem, because nothing
 * in this module is written to disk at all.
 */
const CONTROL_CHARS = new RegExp(
  '[\\u0000-\\u001F\\u007F-\\u009F\\u200B-\\u200F\\u202A-\\u202E\\uFEFF]',
  'g',
);

function safeLabel(raw: string, fallback: string): string {
  const cleaned = String(raw ?? '')
    .replace(CONTROL_CHARS, '')
    .replace(/[\\/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

// ---------------------------- routes ----------------------------

documentsRouter.get('/session', (req, res) => {
  try {
    res.json(sessionPayload(sessionFor(req)));
  } catch (err) { return safeError(res, err); }
});

/**
 * POST /api/documents/upload
 *
 * Raw body rather than multipart: one file per request keeps the parser
 * surface tiny, and a multipart library is a dependency with a long history
 * of path-traversal and resource-exhaustion issues on exactly this kind of
 * endpoint.
 */
documentsRouter.post(
  '/upload',
  express.raw({ type: ['image/*', 'application/pdf', 'application/octet-stream'], limit: 8 * 1024 * 1024 }),
  async (req: Request, res: Response) => {
    try {
      const session = sessionFor(req);
      if (session.documents.length >= MAX_DOCUMENTS) {
        return res.status(409).json({
          error: 'too_many',
          message: `You can compare up to ${MAX_DOCUMENTS} documents at a time. Remove one first.`,
        });
      }

      const buf = req.body as Buffer;
      if (!Buffer.isBuffer(buf) || !buf.length) {
        return res.status(400).json({ error: 'empty_body', message: 'No file was received.' });
      }

      // The sniffed type wins over the declared one, always.
      const mime = sniffDocument(buf);
      if (!mime) {
        return res.status(415).json({
          error: 'unsupported_type',
          message: 'That file is not a JPG, PNG, WEBP or PDF. Photograph the document, or export it as a PDF.',
        });
      }

      const check = validateUpload(mime, buf.length);
      if (!check.ok) return res.status(413).json({ error: 'invalid_file', message: check.reason });

      const hintedRaw = String(req.get('x-document-type') ?? '');
      const hintedType = (DOCUMENT_TYPES as readonly string[]).includes(hintedRaw)
        ? (hintedRaw as DocumentType)
        : undefined;

      const extraction = await extractDocument({ bytes: buf, mimeType: mime, hintedType });

      const doc: SessionDocument = {
        id: crypto.randomUUID(),
        label: safeLabel(req.get('x-file-name') ?? '', DOCUMENT_LABELS[extraction.documentType]),
        documentType: extraction.documentType,
        fields: extraction.fields,
        confidence: extraction.confidence,
        simulated: extraction.simulated,
        error: extraction.error,
        source: 'upload',
        addedAt: new Date().toISOString(),
      };

      addDocument(session, doc);
      res.status(201).json({ ok: true, document: publicDoc(doc), ...sessionPayload(session) });
    } catch (err) { return safeError(res, err); }
  },
);

documentsRouter.post('/remove', (req, res) => {
  try {
    const session = sessionFor(req);
    const id = String(req.body?.id ?? '');
    const before = session.documents.length;
    session.documents = session.documents.filter(d => d.id !== id);
    if (session.documents.length !== before) session.report = null;
    res.json(sessionPayload(session));
  } catch (err) { return safeError(res, err); }
});

documentsRouter.post('/clear', (req, res) => {
  try {
    res.json(sessionPayload(clearDocuments(req)));
  } catch (err) { return safeError(res, err); }
});

/**
 * Withdraw everything, including the DigiLocker authorisation. Separate from
 * /clear on purpose — a citizen who wants their data gone should have a
 * control that unambiguously means that.
 */
documentsRouter.post('/forget', (req, res) => {
  try {
    dropSession(req);
    res.json({ ...sessionPayload(sessionFor(req)), forgotten: true });
  } catch (err) { return safeError(res, err); }
});

documentsRouter.post('/verify', async (req, res) => {
  try {
    const session = sessionFor(req);
    const inputs: VerifiableDocument[] = session.documents.map(d => ({
      id: d.id, label: d.label, documentType: d.documentType,
      fields: d.fields, confidence: d.confidence, simulated: d.simulated, error: d.error,
    }));

    session.report = await verifyDocuments(inputs);
    res.json(sessionPayload(session));
  } catch (err) { return safeError(res, err); }
});

export const documentVerificationStatus = () => ({
  activeSessions: sessions.size,
  retention: 'in-memory only; nothing is written to the database',
  ttlMinutes: Math.round(SESSION_TTL_MS / 60_000),
  demoMode: demoModeEnabled(),
});
