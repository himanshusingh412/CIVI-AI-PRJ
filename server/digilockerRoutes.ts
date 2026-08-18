import express from 'express';
import crypto from 'node:crypto';
import {
  beginAuthorization, completeAuthorization, exchangeCode, isAuthorised,
  listIssuedDocuments, digilockerStatus,
} from './digilocker.js';
import { modeOf } from './config.js';
import { safeError } from './security.js';
import { sessionFor, sessionPayload, addDocument, MAX_DOCUMENTS } from './documents.js';

/**
 * DigiLocker routes.
 *
 * Split from documents.ts because they answer a different question: that
 * file owns "what documents is this citizen comparing", this one owns "how
 * did those documents get here". Keeping the OAuth round trip separate also
 * keeps its redirect handling away from the upload parser, which is the one
 * place in the app that touches raw bytes.
 */
export const digilockerRouter = express.Router();

digilockerRouter.get('/status', (_req, res) => res.json(digilockerStatus()));

digilockerRouter.post('/authorize', (req, res) => {
  try {
    if (modeOf('digilocker') === 'disabled') {
      return res.status(503).json({
        error: 'disabled',
        message: 'DigiLocker is switched off on this deployment.',
      });
    }
    const session = sessionFor(req);
    const started = beginAuthorization();
    session.digilockerSessionId = started.sessionId;
    res.json({ ok: true, ...started, status: digilockerStatus() });
  } catch (err) { return safeError(res, err); }
});

/**
 * The simulated consent screen.
 *
 * Served as a plain HTML page rather than a React route because that is what
 * the real flow does: the citizen LEAVES CivicAI, authenticates on the
 * government's own domain, and comes back. Reproducing that shape - including
 * the fact that you are somewhere else for a moment - is the honest way to
 * demonstrate it, and it means the code path being shown is the code path
 * that would ship.
 *
 * The page says in its first sentence that it is not DigiLocker.
 */
digilockerRouter.get('/demo-consent', (req, res) => {
  // In live mode this page must not exist at all - a simulated consent
  // screen reachable on a deployment with real credentials is a phishing
  // page hosted by the government portal itself.
  if (modeOf('digilocker') === 'live') return res.status(404).json({ error: 'not_found' });

  const state = String(req.query.state ?? '');
  const session = String(req.query.session ?? '');

  // Both values are reflected into markup, so escape before they get near it.
  const esc = (s: string) =>
    s.replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Simulated DigiLocker consent</title>
<style>
  :root { color-scheme: light; }
  body { margin:0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
         background:#F8FAFC; color:#0F172A; display:grid; place-items:center;
         min-height:100vh; padding:1.5rem; }
  .banner { background:#B45309; color:#fff; padding:.85rem 1rem; border-radius:.75rem;
            font-size:.8125rem; font-weight:700; margin-bottom:1rem; max-width:31rem; line-height:1.55; }
  .card { background:#fff; border:1px solid #E2E8F0; border-radius:1rem; padding:2rem;
          max-width:31rem; box-shadow:0 10px 30px rgb(15 23 42 / .08); }
  h1 { font-size:1.25rem; margin:0 0 .75rem; }
  p { font-size:.875rem; line-height:1.65; color:#334155; }
  ul { font-size:.875rem; color:#334155; line-height:1.75; padding-left:1.25rem; }
  .row { display:flex; gap:.75rem; margin-top:1.5rem; }
  button, a.btn { flex:1; text-align:center; text-decoration:none; font:inherit; font-weight:700;
           font-size:.875rem; padding:.8rem 1rem; border-radius:.75rem; border:1px solid #CBD5E1;
           background:#fff; color:#0F172A; cursor:pointer; }
  .primary { background:#0369A1; color:#fff; border-color:#0369A1; }
  .note { font-size:.75rem; color:#475569; margin-top:1rem; }
</style></head>
<body>
  <div>
    <p class="banner">
      SIMULATION - this is not DigiLocker. No DigiLocker partner credentials are
      configured on this deployment, so this page reproduces the authorisation
      step against sample documents. No real government record is being accessed.
    </p>
    <main class="card">
      <h1>Share documents with CivicAI?</h1>
      <p>CivicAI is asking permission to read the following from your document locker:</p>
      <ul>
        <li>The list of documents issued to you</li>
        <li>The details on the documents you choose to share</li>
      </ul>
      <p><strong>Read-only.</strong> CivicAI cannot add, change or delete anything in
         your locker, and never sees your locker password.</p>
      <form method="GET" action="/api/digilocker/callback" class="row">
        <input type="hidden" name="state" value="${esc(state)}">
        <input type="hidden" name="session" value="${esc(session)}">
        <input type="hidden" name="code" value="simulated-authorization-code">
        <a class="btn" href="/portal/documents">Cancel</a>
        <button class="primary" type="submit">Allow</button>
      </form>
      <p class="note">In a live deployment this screen is served by
         digilocker.meripehchaan.gov.in, not by CivicAI.</p>
    </main>
  </div>
</body></html>`);
});

digilockerRouter.get('/callback', async (req, res) => {
  try {
    const session = sessionFor(req);
    const dlSession = String(req.query.session ?? session.digilockerSessionId ?? '');
    const state = String(req.query.state ?? '');
    const code = String(req.query.code ?? '');

    if (!dlSession) return res.redirect('/portal/documents?digilocker=expired');

    const result = modeOf('digilocker') === 'live'
      ? await exchangeCode(dlSession, code, state)
      : completeAuthorization(dlSession, state);

    if (!result.ok) return res.redirect('/portal/documents?digilocker=failed');

    session.digilockerSessionId = dlSession;
    // Back into the SPA, which then lists what is available to import.
    return res.redirect('/portal/documents?digilocker=authorised');
  } catch {
    return res.redirect('/portal/documents?digilocker=failed');
  }
});

digilockerRouter.get('/documents', async (req, res) => {
  try {
    const session = sessionFor(req);
    const dlSession = session.digilockerSessionId;
    if (!dlSession || !isAuthorised(dlSession)) {
      return res.status(401).json({ error: 'not_authorised', message: 'Authorise DigiLocker first.' });
    }
    const docs = await listIssuedDocuments(dlSession);
    res.json({
      ok: true,
      simulated: modeOf('digilocker') !== 'live',
      // The field VALUES are deliberately not returned here. This endpoint
      // answers "what is available"; the citizen has not yet chosen to share
      // anything, so nothing personal crosses the wire until they do.
      documents: docs.map(d => ({
        id: d.id, name: d.name, documentType: d.documentType,
        typeLabel: d.typeLabel, issuer: d.issuer, issuedOn: d.issuedOn,
        simulated: d.simulated,
      })),
    });
  } catch (err: any) {
    if (err?.status === 501) return res.status(501).json({ error: 'not_implemented', message: err.message });
    if (err?.status === 401) return res.status(401).json({ error: 'not_authorised', message: 'Authorise DigiLocker first.' });
    return safeError(res, err);
  }
});

/** Pull the SELECTED issued documents into the verification session. */
digilockerRouter.post('/import', async (req, res) => {
  try {
    const session = sessionFor(req);
    const dlSession = session.digilockerSessionId;
    if (!dlSession || !isAuthorised(dlSession)) {
      return res.status(401).json({ error: 'not_authorised', message: 'Authorise DigiLocker first.' });
    }

    const wanted: string[] = Array.isArray(req.body?.ids)
      ? req.body.ids.map(String).slice(0, MAX_DOCUMENTS)
      : [];
    if (!wanted.length) {
      return res.status(400).json({ error: 'no_selection', message: 'Choose at least one document.' });
    }

    const available = await listIssuedDocuments(dlSession);
    // Only what was ticked. Importing the whole locker because it is easier
    // would be exactly the overreach the consent screen promised against.
    const chosen = available.filter(d => wanted.includes(d.id));

    let imported = 0;
    for (const d of chosen) {
      if (session.documents.length >= MAX_DOCUMENTS) break;
      if (session.documents.some(x => x.source === 'digilocker' && x.label === d.name)) continue;
      addDocument(session, {
        id: crypto.randomUUID(),
        label: d.name,
        documentType: d.documentType,
        fields: d.fields,
        // Issued documents arrive as signed structured data, not photographs,
        // so there is no OCR step and no OCR uncertainty to report.
        confidence: 1,
        simulated: d.simulated,
        source: 'digilocker',
        addedAt: new Date().toISOString(),
      });
      imported++;
    }

    res.json({ ok: true, imported, ...sessionPayload(session) });
  } catch (err: any) {
    if (err?.status === 501) return res.status(501).json({ error: 'not_implemented', message: err.message });
    return safeError(res, err);
  }
});
