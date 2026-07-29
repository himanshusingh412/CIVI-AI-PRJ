import type { Request, Response, NextFunction } from 'express';

type Bucket = { count: number; resetAt: number };

/**
 * In-memory fixed-window rate limiter.
 * For a single-instance hackathon/demo deployment this is sufficient.
 * For multi-instance production, swap the Map for Redis (same interface).
 */
export function createRateLimiter(opts: {
  windowMs: number;
  max: number;
  name: string;
  keyFn?: (req: Request) => string;
}) {
  const buckets = new Map<string, Bucket>();

  // periodic sweep so the map cannot grow unbounded
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, b] of buckets) if (b.resetAt <= now) buckets.delete(key);
  }, 60_000);
  sweep.unref?.();

  return function rateLimit(req: Request, res: Response, next: NextFunction) {
    const key = opts.keyFn ? opts.keyFn(req) : ipOf(req);
    const now = Date.now();
    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + opts.windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    const remaining = Math.max(0, opts.max - bucket.count);
    const resetSec = Math.ceil((bucket.resetAt - now) / 1000);

    res.setHeader('RateLimit-Limit', String(opts.max));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(resetSec));

    if (bucket.count > opts.max) {
      res.setHeader('Retry-After', String(resetSec));
      return res.status(429).json({
        error: 'rate_limited',
        message: `Too many requests. Try again in ${resetSec}s.`,
        retryAfter: resetSec,
      });
    }

    next();
  };
}

export function ipOf(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}
