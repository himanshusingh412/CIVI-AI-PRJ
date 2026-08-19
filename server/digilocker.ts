import crypto from 'node:crypto';
import { modeOf, isProduction } from './config.js';
import { DOCUMENT_LABELS, EMPTY_FIELDS, type DocumentType, type ExtractedFields } from './ocr.js';

/**
 * DigiLocker.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * What this is, and what it is honestly not
 * ─────────────────────────────────────────────────────────────────────────
 * DigiLocker is MeitY's issued-document service. Real access needs an
 * approved partner account, and this deployment may or may not have one. So
 * this module implements the real OAuth 2.0 authorisation-code flow, and
 * ALSO implements a simulator that walks the identical flow against sample
 * documents.
 *
 * Which one is in use is decided by whether credentials exist, reported by
 * `modeOf('digilocker')`, and shown in the UI as "Live" or "Demo" on every
 * screen the flow touches. The word "connected" is never used, because the
 * simulator connects to nothing.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Two non-negotiables
 * ─────────────────────────────────────────────────────────────────────────
 *  1. CivicAI never sees, asks for, or stores a DigiLocker password. The
 *     citizen authenticates with DigiLocker; CivicAI receives a scoped
 *     token. Any design that routes the credential through this server is
 *     wrong regardless of how convenient it is.
 *  2. The simulator is never described as the real thing. Its documents are
 *     tagged `simulated: true` all the way through to the report.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Why DigiLocker documents skip OCR
 * ─────────────────────────────────────────────────────────────────────────
 * Issued documents come back as structured data signed by the issuer, not as
 * photographs. So there is nothing to read — the fields arrive already
 * parsed, and at higher confidence than any camera photo. The simulator
 * mirrors that shape rather than pretending to run OCR over a fake JPEG.
 */

const CLIENT_ID = () => process.env.DIGILOCKER_CLIENT_ID || '';
const CLIENT_SECRET = () => process.env.DIGILOCKER_CLIENT_SECRET || '';
/**
 * The OAuth callback URL.
 *
 * Falls back to localhost, which is right in development and a silent
 * deployment failure in production — the authorisation would complete on
 * DigiLocker's side and then redirect the citizen to a machine that is not
 * there. So production without PUBLIC_BASE_URL is reported rather than
 * papered over: it surfaces in digilockerStatus() and therefore at
 * /api/health, where an operator will actually see it.
 */
const REDIRECT_URI = () =>
  process.env.DIGILOCKER_REDIRECT_URI ||
  `${process.env.PUBLIC_BASE_URL || 'http://localhost:3000'}/api/digilocker/callback`;

const redirectUriIsLocal = () => /localhost|127\.0\.0\.1/.test(REDIRECT_URI());

/** Production endpoints. Only reached when real credentials are configured. */
const AUTHORIZE_ENDPOINT = 'https://digilocker.meripehchaan.gov.in/public/oauth2/1/authorize';
const TOKEN_ENDPOINT = 'https://digilocker.meripehchaan.gov.in/public/oauth2/1/token';

export type DigiLockerDocument = {
  id: string;
  name: string;
  documentType: DocumentType;
  typeLabel: string;
  issuer: string;
  issuedOn: string;
  /** Structured fields as issued. Null when the type carries no such field. */
  fields: ExtractedFields;
  simulated: boolean;
};

export const digilockerStatus = () => {
  const mode = modeOf('digilocker');
  const misconfiguredRedirect = isProduction() && redirectUriIsLocal();
  if (misconfiguredRedirect) {
    console.error(
      '[digilocker] PUBLIC_BASE_URL is not set in production, so the OAuth callback ' +
      'points at localhost. Authorisation will complete on DigiLocker and then fail ' +
      'to return. Set PUBLIC_BASE_URL or DIGILOCKER_REDIRECT_URI.',
    );
  }
  return {
    mode,
    misconfiguredRedirect,
    /** Never "connected" — that would imply a live session that does not exist. */
    label:
      mode === 'live' ? 'DigiLocker configured'
        : mode === 'demo' ? 'Demo DigiLocker (simulated)'
          : mode === 'config_required' ? 'DigiLocker — configuration required'
            : 'DigiLocker disabled',
    redirectUri: REDIRECT_URI(),
  };
};

// ───────────────────────── authorisation sessions ─────────────────────────

type DlSession = {
  id: string;
  state: string;
  createdAt: number;
  authorised: boolean;
  simulated: boolean;
  /** Access token, real mode only. Never sent to the browser. */
  accessToken?: string;
};

/**
 * In-memory and short-lived, deliberately. An access token to somebody's
 * government document locker is not something to keep a minute longer than
 * the flow needs. On a multi-instance deployment this must move to Redis —
 * noted rather than silently broken, since a citizen would experience it as
 * an authorisation that randomly fails.
 */
const SESSION_TTL_MS = 15 * 60_000;
const sessions = new Map<string, DlSession>();

const sweep = setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, s] of sessions) if (s.createdAt < cutoff) sessions.delete(id);
}, 60_000);
sweep.unref?.();

export function beginAuthorization(): { sessionId: string; authorizeUrl: string; simulated: boolean } {
  const mode = modeOf('digilocker');
  const sessionId = crypto.randomUUID();
  // CSRF protection for the OAuth round trip: the value comes back on the
  // redirect and must match, or the callback is somebody else's.
  const state = crypto.randomBytes(24).toString('base64url');
  const simulated = mode !== 'live';

  sessions.set(sessionId, { id: sessionId, state, createdAt: Date.now(), authorised: false, simulated });

  if (!simulated) {
    const url = new URL(AUTHORIZE_ENDPOINT);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', CLIENT_ID());
    url.searchParams.set('redirect_uri', REDIRECT_URI());
    url.searchParams.set('state', state);
    // Read-only. CivicAI has no reason to ever write to someone's locker.
    url.searchParams.set('scope', 'files.issueddocs');
    return { sessionId, authorizeUrl: url.toString(), simulated: false };
  }

  /**
   * Simulated consent screen, served by this application. It walks the same
   * shape as the real thing — a page the citizen must actively approve, a
   * state parameter, a redirect back — so the flow being demonstrated is the
   * flow that would ship. It is labelled as a simulation on the page itself.
   */
  return {
    sessionId,
    authorizeUrl: `/api/digilocker/demo-consent?state=${encodeURIComponent(state)}&session=${sessionId}`,
    simulated: true,
  };
}

export function completeAuthorization(sessionId: string, state: string): { ok: true } | { ok: false; reason: string } {
  const s = sessions.get(sessionId);
  if (!s) return { ok: false, reason: 'This authorisation request has expired. Please start again.' };
  // Constant-time is overkill for a value the attacker cannot iterate
  // against a live oracle, but the comparison is cheap and the habit is right.
  if (!crypto.timingSafeEqual(Buffer.from(s.state), Buffer.from(String(state).padEnd(s.state.length).slice(0, s.state.length)))) {
    return { ok: false, reason: 'Authorisation could not be verified. Please start again.' };
  }
  s.authorised = true;
  return { ok: true };
}

export async function exchangeCode(sessionId: string, code: string, state: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const s = sessions.get(sessionId);
  if (!s) return { ok: false, reason: 'This authorisation request has expired. Please start again.' };
  if (s.state !== state) return { ok: false, reason: 'Authorisation could not be verified. Please start again.' };

  if (s.simulated) {
    s.authorised = true;
    return { ok: true };
  }

  try {
    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: CLIENT_ID(),
        client_secret: CLIENT_SECRET(),
        redirect_uri: REDIRECT_URI(),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { ok: false, reason: 'DigiLocker declined the authorisation. Please try again.' };
    const body: any = await res.json();
    s.accessToken = body?.access_token;
    s.authorised = !!s.accessToken;
    return s.authorised
      ? { ok: true }
      : { ok: false, reason: 'DigiLocker did not return an access token.' };
  } catch {
    // Never surface the provider's error text: it can carry client ids and
    // internal endpoints.
    return { ok: false, reason: 'Could not reach DigiLocker. Please try again shortly.' };
  }
}

export const isAuthorised = (sessionId: string): boolean => !!sessions.get(sessionId)?.authorised;

// ───────────────────────── documents ─────────────────────────

/**
 * Sample issued documents for the simulator.
 *
 * These carry the SAME persona as the OCR fixtures on purpose, including the
 * date-of-birth convention difference between the identity card and the PAN
 * card. That is what makes the end-to-end demo show a real finding rather
 * than four documents that trivially agree.
 */
const SAMPLE_DOCUMENTS: DigiLockerDocument[] = [
  {
    id: 'dl-aadhaar', name: 'Aadhaar', documentType: 'identity_card',
    typeLabel: DOCUMENT_LABELS.identity_card,
    issuer: 'Unique Identification Authority of India', issuedOn: '2016-08-11',
    simulated: true,
    fields: {
      ...EMPTY_FIELDS,
      name: 'Rahul Kumar Singh',
      fatherName: 'Mahesh Kumar Singh',
      dob: '12/03/2001',
      gender: 'Male',
      address: 'H.No 214, Sector 14, Dwarka, New Delhi 110078',
      documentNumber: '4321 8765 2109',
      issuingAuthority: 'Unique Identification Authority of India',
    },
  },
  {
    id: 'dl-pan', name: 'PAN Verification Record', documentType: 'pan_card',
    typeLabel: DOCUMENT_LABELS.pan_card,
    issuer: 'Income Tax Department', issuedOn: '2019-02-04',
    simulated: true,
    fields: {
      ...EMPTY_FIELDS,
      name: 'Rahul K. Singh',
      fatherName: 'Mahesh Kumar Singh',
      dob: '03/12/2001',
      documentNumber: 'BKJPS4321M',
      issuingAuthority: 'Income Tax Department',
    },
  },
  {
    id: 'dl-class10', name: 'Class X Marksheet', documentType: 'educational_certificate',
    typeLabel: DOCUMENT_LABELS.educational_certificate,
    issuer: 'Central Board of Secondary Education', issuedOn: '2017-07-15',
    simulated: true,
    fields: {
      ...EMPTY_FIELDS,
      name: 'Rahul Kumar Singh',
      fatherName: 'Mahesh K. Singh',
      dob: '12 March 2001',
      documentNumber: 'CBSE/2017/2214887',
      issueDate: '15/07/2017',
      issuingAuthority: 'Central Board of Secondary Education',
    },
  },
  {
    id: 'dl-driving', name: 'Driving Licence', documentType: 'driving_licence',
    typeLabel: DOCUMENT_LABELS.driving_licence,
    issuer: 'Transport Department, NCT of Delhi', issuedOn: '2021-11-30',
    simulated: true,
    fields: {
      ...EMPTY_FIELDS,
      name: 'Rahul Kumar Singh',
      dob: '12/03/2001',
      gender: 'Male',
      address: 'House No 214, Sec 14, Dwarka, New Delhi 110075',
      documentNumber: 'DL-0420110149646',
      issueDate: '30/11/2021',
      expiryDate: '29/11/2041',
      issuingAuthority: 'Transport Department, NCT of Delhi',
    },
  },
];

export async function listIssuedDocuments(sessionId: string): Promise<DigiLockerDocument[]> {
  const s = sessions.get(sessionId);
  if (!s?.authorised) throw Object.assign(new Error('not_authorised'), { status: 401 });

  if (s.simulated) return SAMPLE_DOCUMENTS.map(d => ({ ...d }));

  /**
   * Real mode. The issued-documents endpoint returns a list; per-document
   * detail is fetched separately. Deliberately NOT implemented against a
   * guessed response shape — writing a parser for an API this code has never
   * received a response from would produce something that looks finished and
   * fails on contact.
   */
  throw Object.assign(
    new Error(
      'Live DigiLocker credentials are configured, but the issued-documents parser has not been ' +
      'validated against a real partner response. Contact the maintainer before enabling this in production.',
    ),
    { status: 501 },
  );
}
