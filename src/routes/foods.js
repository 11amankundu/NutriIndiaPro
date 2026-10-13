// Foods catalogue: public reads (cacheable by shared caches), admin-only writes.
const express = require('express');
const { AppError, parseId } = require('../errors');
const { validateBody, validateQuery } = require('../middleware/validate');
const { authenticate, requireRole } = require('../middleware/auth');
const { buildPage } = require('../pagination');

const PUBLIC_CACHE = { cacheControl: 'public, max-age=300' };

module.exports = ({ cfg, db, svc }) => {
  const r = express.Router();
  const auth = authenticate(cfg);
  const admin = [auth, requireRole('admin')];
  const idem = require('../middleware/idempotency')(db);
  const found = (f) => { if (!f) throw new AppError(404, 'NOT_FOUND', 'Food not found'); return f; };

  r.get('/foods', validateQuery('foods'), (req, res) => {
    const { q, limit, cursor } = req.q;
    const rows = svc.listFoods({ q, limit: limit + 1, cursor });
    res.respond(200, buildPage(req, res, rows, limit, (f) => [f.id]), PUBLIC_CACHE);
  });
  r.get('/foods/:id', (req, res) => res.respond(200, found(svc.getFood(parseId(req.params.id))), PUBLIC_CACHE));

  r.post('/foods', ...admin, idem, validateBody('foodInput'), (req, res) => {
    const f = svc.createFood(req.body);
    res.set('Location', `/v1/foods/${f.id}`);
    res.respond(201, f);
  });
  r.put('/foods/:id', ...admin, validateBody('foodInput'), (req, res) => {
    res.respond(200, found(svc.replaceFood(parseId(req.params.id), req.body)));
  });
  r.patch('/foods/:id', ...admin, validateBody('foodPatch'), (req, res) => {
    res.respond(200, found(svc.patchFood(parseId(req.params.id), req.body)));
  });
  r.delete('/foods/:id', ...admin, (req, res) => {
    if (!svc.deleteFood(parseId(req.params.id))) throw new AppError(404, 'NOT_FOUND', 'Food not found');
    res.respond(204);
  });
  return r;
};
