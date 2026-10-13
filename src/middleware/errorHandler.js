// Centralized error handling: every error leaves the API in the same envelope:
// { "error": { "status", "code", "message", "details"?, "correlationId" } }
const { AppError } = require('../errors');
const logger = require('../logger');

const notFound = (req, res, next) => next(new AppError(404, 'NOT_FOUND', `No route for ${req.method} ${req.path}`));

function errorHandler() {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'Unexpected server error';
    let details;

    if (err instanceof AppError) {
      ({ status, code, message, details } = err);
    } else if (err.type === 'entity.parse.failed') {
      status = 400; code = 'MALFORMED_JSON'; message = 'Request body is not valid JSON';
    } else if (err.type === 'entity.too.large') {
      status = 413; code = 'PAYLOAD_TOO_LARGE'; message = 'Request body is too large';
    } else if (String(err.code || '').startsWith('SQLITE_CONSTRAINT')) {
      status = 409; code = 'CONFLICT'; message = 'Operation conflicts with existing data (duplicate or still referenced)';
    }

    if (status >= 500) logger.error('unhandled_error', { error: err.message, stack: err.stack });
    else logger.warn('request_failed', { status, code });

    if (res.headersSent) return next(err);
    const body = { error: { status, code, message, ...(details ? { details } : {}), correlationId: req.correlationId } };
    if (res.respond) return res.respond(status, body);
    return res.status(status).json(body);
  };
}

module.exports = { errorHandler, notFound };
