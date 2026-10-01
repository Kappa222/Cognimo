// In-memory fixed-window rate limiter for AI-cost endpoints.
//
// Per-instance (process-local): a restart or a multi-instance deploy resets/
// splits the budget — fine for a single-node study app, swap for a shared
// store if that ever changes. Keyed by user id: all guarded routes are
// authenticated, and user keys cannot be spoofed via client-supplied IPs.

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
let opsSinceSweep = 0;

function sweep(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/**
 * Count one request against `key`'s window. Returns a ready-to-send 429
 * (with Retry-After) when the limit is exhausted, or null when allowed.
 * Typical use:
 *
 *   const limited = rateLimit(`chat:${user.id}`, 30, 60_000);
 *   if (limited) return limited;
 */
export function rateLimit(key: string, limit: number, windowMs: number): Response | null {
  const now = Date.now();

  // Opportunistic cleanup so the map never grows unboundedly.
  if (++opsSinceSweep >= 100) {
    opsSinceSweep = 0;
    sweep(now);
  }

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }
  if (bucket.count >= limit) {
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    return new Response("Too many requests", {
      status: 429,
      headers: { "Retry-After": String(retryAfter) },
    });
  }
  bucket.count += 1;
  return null;
}
