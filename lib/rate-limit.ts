// Tiny in-memory sliding-window rate limiter. Per-IP, per-key.
// Good enough for single-instance Coolify deployments. For multi-instance
// we'd swap this for a Redis/Upstash backend — interface stays the same.

type Hit = { count: number; resetAt: number };
const buckets = new Map<string, Hit>();

// Clean up stale entries once a minute so the Map doesn't grow unbounded
// during long-running processes.
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of buckets) if (v.resetAt < now) buckets.delete(k);
  }, 60_000).unref?.();
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetAt: number;
}

export function rateLimit(
  key: string,
  { windowMs, max }: { windowMs: number; max: number }
): RateLimitResult {
  const now = Date.now();
  const entry = buckets.get(key);
  if (!entry || entry.resetAt < now) {
    const fresh = { count: 1, resetAt: now + windowMs };
    buckets.set(key, fresh);
    return { ok: true, remaining: max - 1, resetAt: fresh.resetAt };
  }
  if (entry.count >= max) {
    return { ok: false, remaining: 0, resetAt: entry.resetAt };
  }
  entry.count += 1;
  return { ok: true, remaining: max - entry.count, resetAt: entry.resetAt };
}

// Derive a stable client identifier from the request. In production behind
// Coolify + Traefik, the real client IP is in `x-forwarded-for`. We fall
// back to `x-real-ip`, then finally to a string literal so the limiter
// still caps a single unknown client.
export function clientKey(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xri = req.headers.get("x-real-ip");
  if (xri) return xri.trim();
  return "unknown";
}
