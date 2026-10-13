// Deliberate CORS policy: explicit allow-list of origins (CORS_ORIGINS), explicit methods/headers,
// no wildcard, no credentials (we use bearer tokens, not cookies).
const ALLOWED_METHODS = 'GET,POST,PUT,PATCH,DELETE,OPTIONS';
const ALLOWED_HEADERS = 'Content-Type,Authorization,Idempotency-Key,If-None-Match,X-Correlation-ID,Accept';
const EXPOSED_HEADERS = 'ETag,Link,Location,Retry-After,X-Correlation-ID,Idempotent-Replayed,RateLimit-Limit,RateLimit-Remaining,RateLimit-Reset,X-RateLimit-Limit,X-RateLimit-Remaining,X-RateLimit-Reset';

module.exports = function cors(cfg) {
  const allowed = new Set(cfg.corsOrigins);
  return (req, res, next) => {
    const origin = req.get('Origin');
    if (!origin) return next(); // same-origin or non-browser client
    res.vary('Origin');
    const ok = allowed.has(origin);
    if (ok) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Access-Control-Expose-Headers', EXPOSED_HEADERS);
    }
    if (req.method === 'OPTIONS' && req.get('Access-Control-Request-Method')) {
      if (!ok) return res.status(403).json({ error: { status: 403, code: 'CORS_ORIGIN_NOT_ALLOWED', message: 'Origin is not in the allow-list', correlationId: req.correlationId } });
      res.set('Access-Control-Allow-Methods', ALLOWED_METHODS);
      res.set('Access-Control-Allow-Headers', ALLOWED_HEADERS);
      res.set('Access-Control-Max-Age', '600');
      return res.status(204).end();
    }
    return next();
  };
};
