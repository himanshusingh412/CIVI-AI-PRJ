import express, { type Request, type Response } from 'express';
import crypto from 'node:crypto';

/**
 * Complaint photo storage.
 *
 * The UI has always accepted images; nothing ever persisted them, so the
 * "upload images" claim was false the moment a page reloaded.
 *
 * Bytes live in Postgres rather than S3. That is a deliberate trade for
 * this stage: it needs no extra vendor, no credentials, no bucket policy,
 * and it inherits the backups and access control the database already has.
 * It does NOT scale — Postgres is a poor blob store past a few GB, and rows
 * this large bloat the WAL. The `storage_key` column exists so a later move
 * to object storage is a backfill, not a schema change.
 *
 * Everything below assumes hostile input, because a public grievance portal
 * accepting file uploads is the most attacker-facing surface in the app.
 */

/** Magic-number sniffing. An attacker controls the filename and the
 *  Content-Type header; they do not control the first bytes as easily. */
const SIGNATURES: { mime: string; ext: string; test: (b: Buffer) => boolean }[] = [
  { mime: 'image/jpeg', ext: 'jpg', test: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png',  ext: 'png', test: b => b.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])) },
  { mime: 'image/webp', ext: 'webp', test: b => b.subarray(0,4).toString('ascii') === 'RIFF' && b.subarray(8,12).toString('ascii') === 'WEBP' },
];

export const MAX_BYTES = 5 * 1024 * 1024;

export function sniff(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.length < 12) return null;
  return SIGNATURES.find(s => s.test(buf)) ?? null;
}

export interface MediaRow {
  id: string;
  complaintId: string;
  mime: string;
  bytes: Buffer;
  fileName: string;
  size: number;
}

/**
 * In-memory fallback so uploads work before DATABASE_URL is configured,
 * mirroring how the complaint store behaves. Non-durable by definition.
 */
const memory = new Map<string, MediaRow>();

type Sql = ((s: TemplateStringsArray, ...v: unknown[]) => Promise<any[]>) | null;
let sql: Sql = null;
export function useMediaPostgres(client: Sql) { sql = client; }

export async function putMedia(complaintId: string, buf: Buffer, name: string): Promise<MediaRow> {
  const kind = sniff(buf);
  if (!kind) throw Object.assign(new Error('unsupported_type'), { status: 415 });
  if (buf.length > MAX_BYTES) throw Object.assign(new Error('too_large'), { status: 413 });

  const id = crypto.randomUUID();
  // The stored filename is generated, never the client's. An uploaded name
  // like "../../.env" or "x.php" should never reach a filesystem or a URL.
  const fileName = `${id}.${kind.ext}`;
  const row: MediaRow = { id, complaintId, mime: kind.mime, bytes: buf, fileName, size: buf.length };

  if (sql) {
    await sql`
      INSERT INTO complaint_media (id, complaint_id, kind, file_url, storage_key, file_name, mime_type, file_size, content)
      VALUES (${id}::uuid, ${complaintId}::uuid, 'image', ${'/api/media/' + id}, ${fileName},
              ${fileName}, ${kind.mime}, ${buf.length}, ${buf})`;
  } else {
    memory.set(id, row);
  }
  return row;
}

export async function getMedia(id: string): Promise<MediaRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  if (sql) {
    const rows = await sql`
      SELECT id, complaint_id, mime_type, file_name, file_size, content
      FROM complaint_media WHERE id = ${id}::uuid AND deleted_at IS NULL LIMIT 1`;
    const r = rows[0];
    if (!r || !r.content) return null;
    return { id: r.id, complaintId: r.complaint_id, mime: r.mime_type,
             bytes: Buffer.from(r.content), fileName: r.file_name, size: r.file_size };
  }
  return memory.get(id) ?? null;
}

export const mediaRouter = express.Router();

/** Raw body, capped. express.json() does not apply to these routes. */
mediaRouter.post(
  '/:complaintId',
  express.raw({ type: ['image/*', 'application/octet-stream'], limit: MAX_BYTES }),
  async (req: Request, res: Response) => {
    try {
      const buf = req.body as Buffer;
      if (!Buffer.isBuffer(buf) || !buf.length) {
        return res.status(400).json({ error: 'empty_body' });
      }
      const row = await putMedia(req.params.complaintId, buf, String(req.get('x-file-name') ?? ''));
      res.status(201).json({ id: row.id, url: `/api/media/${row.id}`, size: row.size, mime: row.mime });
    } catch (e: any) {
      res.status(e?.status ?? 500).json({ error: e?.message ?? 'upload_failed' });
    }
  },
);

export async function serveMedia(req: Request, res: Response) {
  const row = await getMedia(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });

  res.setHeader('Content-Type', row.mime);
  res.setHeader('Content-Length', String(row.size));
  // Content-addressed by uuid, so it can never change under a given URL.
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  // Belt and braces: even if sniffing were bypassed, forbid the browser from
  // re-interpreting the bytes as script, and forbid inline rendering as HTML.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `inline; filename="${row.fileName}"`);
  res.send(row.bytes);
}
