// Resource-oriented auth: POST /v1/users (sign up) and POST /v1/sessions (log in) - nouns, no verbs.
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { AppError, wrap, parseId } = require('../errors');
const { validateBody, validateQuery } = require('../middleware/validate');
const { authenticate, requireRole } = require('../middleware/auth');
const { buildPage } = require('../pagination');

module.exports = ({ cfg, db, svc, nosql }) => {
  const r = express.Router();
  const auth = authenticate(cfg);
  const idem = require('../middleware/idempotency')(db);

  r.post('/users', idem, validateBody('userCreate'), wrap(async (req, res) => {
    const { email, password, name } = req.body;
    const passwordHash = await bcrypt.hash(password, cfg.bcryptRounds);
    const user = svc.createUser({ email: email.toLowerCase(), passwordHash, name });
    if (!user) throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists');
    nosql.logActivity(user.id, 'user_registered');
    res.set('Location', `/v1/users/${user.id}`);
    res.respond(201, user);
  }));

  r.post('/sessions', validateBody('sessionCreate'), wrap(async (req, res) => {
    const row = svc.getUserAuthByEmail(req.body.email.toLowerCase());
    const ok = row && await bcrypt.compare(req.body.password, row.passwordHash);
    if (!ok) throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
    const accessToken = jwt.sign({ role: row.role, email: row.email }, cfg.jwtSecret, {
      algorithm: 'HS256', subject: String(row.id), expiresIn: cfg.jwtExpiresIn,
    });
    nosql.logActivity(row.id, 'session_created');
    res.respond(201, {
      accessToken, tokenType: 'Bearer', expiresIn: cfg.jwtExpiresIn,
      user: { id: row.id, email: row.email, name: row.name, role: row.role },
    });
  }));

  r.get('/users/me', auth, (req, res) => {
    const u = svc.getUserById(req.user.id);
    if (!u) throw new AppError(404, 'NOT_FOUND', 'User no longer exists');
    res.respond(200, u);
  });
  r.patch('/users/me', auth, validateBody('userPatch'), (req, res) => {
    res.respond(200, svc.updateUser(req.user.id, req.body));
  });
  r.delete('/users/me', auth, (req, res) => {
    svc.deleteUser(req.user.id);
    res.respond(204);
  });

  // admin-only
  r.get('/users', auth, requireRole('admin'), validateQuery('page'), (req, res) => {
    const { limit, cursor } = req.q;
    const rows = svc.listUsers({ limit: limit + 1, cursor });
    res.respond(200, buildPage(req, res, rows, limit, (u) => [u.id]));
  });
  r.get('/users/:id', auth, requireRole('admin'), (req, res) => {
    const u = svc.getUserById(parseId(req.params.id));
    if (!u) throw new AppError(404, 'NOT_FOUND', 'User not found');
    res.respond(200, u);
  });
  r.delete('/users/:id', auth, requireRole('admin'), (req, res) => {
    if (!svc.deleteUser(parseId(req.params.id))) throw new AppError(404, 'NOT_FOUND', 'User not found');
    res.respond(204);
  });
  return r;
};
