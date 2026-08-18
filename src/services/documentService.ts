/**
 * Document verification API client.
 *
 * Uploads go up as a raw body with the filename in a header rather than as
 * multipart form-data. That mirrors the server (see server/documents.ts) and
 * keeps one file per request, so a failed upload is one failed document
 * rather than a partially-applied batch.
 */

function csrfHeader(): Record<string, string> {
  const m = document.cookie.match(/(?:^|; )civicai_csrf=([^;]*)/);
  return m ? { 'x-csrf-token': decodeURIComponent(m[1]) } : {};
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: { ...csrfHeader(), ...(init?.headers as Record<string, string> | undefined) },
  });
  const text = await res.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch {
    throw new Error('CivicAI is not responding. Please try again in a moment.');
  }
  if (!res.ok) throw new Error(data.message || data.error || `Request failed (${res.status})`);
  return data as T;
}

export type ExtractedFields = {
  name: string | null;
  fatherName: string | null;
  motherName: string | null;
  dob: string | null;
  gender: string | null;
  address: string | null;
  documentNumber: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  issuingAuthority: string | null;
};

export type SessionDocument = {
  id: string;
  label: string;
  documentType: string;
  typeLabel: string;
  fields: ExtractedFields;
  confidence: number;
  simulated: boolean;
  error?: string;
  source: 'upload' | 'digilocker';
  addedAt: string;
};

export type Severity = 'ok' | 'info' | 'warning' | 'critical';

export type FieldFinding = {
  field: string;
  label: string;
  severity: Severity;
  values: Array<{ documentId: string; documentLabel: string; raw: string | null; normalised: string | null }>;
  headline: string;
  recommendation: string;
  corroboration: string | null;
  conflictBetween: { a: string; b: string } | null;
  requiresUserAction: boolean;
};

export type VerificationReport = {
  overall: 'verified' | 'review_recommended' | 'action_required' | 'insufficient';
  summary: string;
  findings: FieldFinding[];
  aiExplanation: string | null;
  aiSuggestions: string[];
  provider: string;
  degraded: boolean;
  generatedAt: string;
  simulated: boolean;
};

export type DocumentSession = {
  ok: true;
  documents: SessionDocument[];
  report: VerificationReport | null;
  limits: { maxDocuments: number; expiresInMinutes: number };
  digilocker: { mode: string; label: string; redirectUri: string };
  ocrMode: string;
};

export const getSession = () => call<DocumentSession>('/api/documents/session');

export function uploadDocument(file: File, documentType?: string): Promise<DocumentSession & { document: SessionDocument }> {
  return call('/api/documents/upload', {
    method: 'POST',
    headers: {
      // The browser refuses to send some types on a raw body; octet-stream
      // is always allowed and the server sniffs the real type from the bytes
      // regardless of what this header claims.
      'Content-Type': file.type || 'application/octet-stream',
      'x-file-name': encodeHeader(file.name),
      ...(documentType ? { 'x-document-type': documentType } : {}),
    },
    body: file,
  });
}

/**
 * HTTP headers are latin-1. A filename in Devanagari or Tamil throws a
 * TypeError inside fetch before the request is even sent, which would have
 * meant "upload silently impossible" for exactly the users this portal is
 * for. Non-latin-1 characters are dropped here and the server falls back to
 * naming the document by its detected type.
 */
function encodeHeader(value: string): string {
  return Array.from(value)
    .filter(ch => ch.charCodeAt(0) <= 0xff)
    .join('')
    .slice(0, 120);
}

export const removeDocument = (id: string) =>
  call<DocumentSession>('/api/documents/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });

export const clearDocuments = () =>
  call<DocumentSession>('/api/documents/clear', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });

export const forgetEverything = () =>
  call<DocumentSession>('/api/documents/forget', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });

export const verifyDocuments = () =>
  call<DocumentSession>('/api/documents/verify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });

// ---------------------------- DigiLocker ----------------------------

export type DigiLockerDoc = {
  id: string; name: string; documentType: string; typeLabel: string;
  issuer: string; issuedOn: string; simulated: boolean;
};

export const startDigiLocker = () =>
  call<{ ok: true; sessionId: string; authorizeUrl: string; simulated: boolean }>(
    '/api/digilocker/authorize',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
  );

export const listDigiLockerDocuments = () =>
  call<{ ok: true; simulated: boolean; documents: DigiLockerDoc[] }>('/api/digilocker/documents');

export const importDigiLockerDocuments = (ids: string[]) =>
  call<DocumentSession & { imported: number }>('/api/digilocker/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
