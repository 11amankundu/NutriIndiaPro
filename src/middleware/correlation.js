// Correlation ID: reuse the caller's X-Correlation-ID or generate one; echo it back and attach it to every log line.
const crypto = require('crypto');
const logger = require('../logger');

module.exports = function correlation() {
  return (req, res, next) => {
    const incoming = req.get('X-Correlation-ID');
    const id = incoming && /^[\w.-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
    req.correlationId = id;
    res.set('X-Correlation-ID', id);
    const start = process.hrtime.bigint();
    logger.als.run({ correlationId: id }, () => {
      res.on('finish', () => {
        logger.info('request', {
          correlationId: id,
          method: req.method,
          path: req.originalUrl.split('?')[0],
          status: res.statusCode,
          durationMs: Math.round(Number(process.hrtime.bigint() - start) / 1e4) / 100,
          userId: req.user ? req.user.id : undefined,
        });
      });
      next();
    });
  };
};
