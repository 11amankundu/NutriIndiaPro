class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// Lets async route handlers forward rejected promises to the central error handler (Express 4).
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function parseId(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new AppError(400, 'INVALID_ID', 'Resource id must be a positive integer');
  return n;
}

module.exports = { AppError, wrap, parseId };
