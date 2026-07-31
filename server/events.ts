import type { Request, Response } from 'express';

/**
 * Server-sent events — the "real-time status tracking" the product claims.
 *
 * SSE rather than WebSockets on purpose. The traffic here is one-directional
 * (server tells clients something changed) and SSE is plain HTTP: it works
 * through corporate proxies and government firewalls that block WS upgrades,
 * reconnects automatically in the browser with no client library, and needs
 * no second protocol on the server. WebSockets would buy bidirectionality
 * this app has no use for.
 *
 * Payloads carry an id and a hint, never the complaint itself. Clients
 * re-fetch through the normal authorised endpoints, so RBAC and scope stay
 * enforced in exactly one place. Pushing rows down this channel would mean
 * re-implementing authorisation here — and getting it subtly wrong.
 *
 * DEPLOYMENT NOTE: Vercel's serverless functions cap execution time, so a
 * stream will be cut every ~60s there. EventSource reconnects on its own, so
 * the UX degrades to near-real-time rather than breaking. A persistent host
 * (Render, Fly, a VM) keeps the stream open indefinitely.
 */

export type AppEvent =
  | { type: 'complaint_created'; id: string }
  | { type: 'complaint_updated'; id: string; status?: string }
  | { type: 'sla_breach'; id: string; level: number; hoursOver: number };

type Client = { id: number; res: Response };

const clients = new Set<Client>();
let nextId = 1;

export function publish(event: AppEvent) {
  const frame = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  for (const c of clients) {
    // A client that has gone away mid-write must not take down the loop and
    // stop every other subscriber from being notified.
    try { c.res.write(frame); } catch { clients.delete(c); }
  }
}

export function subscriberCount() {
  return clients.size;
}

export function sseHandler(req: Request, res: Response) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // nginx buffers proxied responses by default, which holds events until
    // the buffer fills and makes "real-time" arrive in bursts minutes late.
    'X-Accel-Buffering': 'no',
  });

  const client: Client = { id: nextId++, res };
  clients.add(client);

  // Tell the browser how long to wait before reconnecting, and confirm the
  // stream is live so the UI can show a connected state truthfully.
  res.write('retry: 5000\n\n');
  res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);

  // Comment frames keep intermediaries from closing an idle connection.
  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { /* closed; cleaned up below */ }
  }, 25_000);
  ping.unref?.();

  req.on('close', () => {
    clearInterval(ping);
    clients.delete(client);
  });
}
