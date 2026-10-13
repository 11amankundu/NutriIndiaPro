// Idempotency-Key for POST: the first successful response is stored and replayed for retries with the same key.
// Same key + different body => 422. Header is optional; without it POST behaves normally.
const crypto = require('crypto');
const { AppError } = require('../errors');

module.exports = function idempotency(db) {
  return (req, res, next) => {
    const key = req.get('Idempotency-Key');
    if (!key) return next();
    if (key.length > 128) return next(new AppError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must be at most 128 characters'));

    const userId = req.user ? req.user.id : 0;
    const path = req.originalUrl.split('?')[0];
    const hash = crypto.createHash('sha256').update(JSON.stringify(req.body || {})).digest('hex');
    const row = db.prepare('SELECT request_hash, status, response_body FROM idempotency_keys WHERE key = ? AND user_id = ? AND method = ? AND path = ?')
      .get(key, userId, req.method, path);

    if (row) {
      if (row.request_hash !== hash) {
        return next(new AppError(422, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used with a different request body'));
      }
      res.set('Idempotent-Replayed', 'true');
      return res.respond(row.status, JSON.parse(row.response_body));
    }

    const original = res.respond;
    res.respond = (status, body, opts) => {
      if (status >= 200 && status < 300) {
        db.prepare('INSERT OR IGNORE INTO idempotency_keys (key, user_id, method, path, request_hash, status, response_body) VALUES (?,?,?,?,?,?,?)')
          .run(key, userId, req.method, path, hash, status, JSON.stringify(body));
      }
      return original(status, body, opts);
    };
    return next();
  };
};
