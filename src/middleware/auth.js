// JWT authentication (HS256) + role-based authorization.
const jwt = require('jsonwebtoken');
const { AppError } = require('../errors');

const bearer = (req) => {
  const m = /^Bearer (.+)$/i.exec(req.get('Authorization') || '');
  return m ? m[1] : null;
};

function verifyToken(cfg, token) {
  const p = jwt.verify(token, cfg.jwtSecret, { algorithms: ['HS256'] });
  return { id: Number(p.sub), role: p.role, email: p.email };
}

function authenticate(cfg) {
  return (req, res, next) => {
    const token = bearer(req);
    if (!token) {
      res.set('WWW-Authenticate', 'Bearer');
      return next(new AppError(401, 'UNAUTHENTICATED', 'Missing or malformed Authorization header (expected: Bearer <token>)'));
    }
    try {
      req.user = verifyToken(cfg, token);
      return next();
    } catch (e) {
      res.set('WWW-Authenticate', 'Bearer error="invalid_token"');
      return next(new AppError(401, e.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN', 'Token is invalid or expired'));
    }
  };
}

// Non-throwing variant (used by GraphQL, which reports auth errors inside the response).
function tryUser(cfg, req) {
  const token = bearer(req);
  if (!token) return null;
  try { return verifyToken(cfg, token); } catch (_) { return null; }
}

const requireRole = (...roles) => (req, res, next) => (roles.includes(req.user.role)
  ? next()
  : next(new AppError(403, 'FORBIDDEN', `This action requires role: ${roles.join(' or ')}`)));

module.exports = { authenticate, requireRole, tryUser };
