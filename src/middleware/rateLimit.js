// Fixed-window in-memory rate limiter with standard headers and HTTP 429 + Retry-After.
const { AppError } = require('../errors');

module.exports = function rateLimit({ max, windowMs }) {
  const hits = new Map();
  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, windowMs);
  sweeper.unref();

  return (req, res, next) => {
    const now = Date.now();
    let e = hits.get(req.ip);
    if (!e || e.reset <= now) {
      e = { count: 0, reset: now + windowMs };
      hits.set(req.ip, e);
    }
    e.count += 1;
    const remaining = Math.max(0, max - e.count);
    const resetIn = Math.ceil((e.reset - now) / 1000);
    res.set({
      'RateLimit-Limit': String(max),
      'RateLimit-Remaining': String(remaining),
      'RateLimit-Reset': String(resetIn),
      'X-RateLimit-Limit': String(max),
      'X-RateLimit-Remaining': String(remaining),
      'X-RateLimit-Reset': String(Math.ceil(e.reset / 1000)),
    });
    if (e.count > max) {
      res.set('Retry-After', String(resetIn));
      return next(new AppError(429, 'RATE_LIMITED', 'Too many requests, slow down', { retryAfterSeconds: resetIn }));
    }
    return next();
  };
};
