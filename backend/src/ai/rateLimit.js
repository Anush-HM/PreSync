import { AiError, sendAiError } from './errors.js';

// Fixed-window limiter per signed-in user, kept in memory. Good enough
// for a single backend process; a multi-instance deployment would move
// the counters to a shared store.
export function createRateLimiter({ limit, windowMs = 60_000, now = () => Date.now() }) {
  const hits = new Map();

  function middleware(req, res, next) {
    const max = typeof limit === 'function' ? limit() : limit;
    const key = req.userId || req.ip;
    const t = now();
    let entry = hits.get(key);
    if (!entry || t - entry.start >= windowMs) {
      entry = { start: t, count: 0 };
      hits.set(key, entry);
    }
    if (entry.count >= max) {
      const retryAfter = Math.max(1, Math.ceil((entry.start + windowMs - t) / 1000));
      return sendAiError(res, new AiError('RATE_LIMITED', 429, `You've reached the Copilot limit of ${max} requests a minute. Try again in ${retryAfter}s.`, { retryAfter }));
    }
    entry.count += 1;
    // Drop stale windows now and then so the map can't grow unbounded.
    if (hits.size > 5000) for (const [k, v] of hits) if (t - v.start >= windowMs) hits.delete(k);
    next();
  }

  middleware.reset = () => hits.clear();
  return middleware;
}
