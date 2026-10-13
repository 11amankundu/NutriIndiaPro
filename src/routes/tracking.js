// Weights, goals and daily summaries (all per-user).
const express = require('express');
const { AppError, parseId } = require('../errors');
const { validateBody, validateQuery } = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { buildPage } = require('../pagination');

module.exports = ({ cfg, db, svc, nosql }) => {
  const r = express.Router();
  const auth = authenticate(cfg);
  const idem = require('../middleware/idempotency')(db);

  r.get('/weights', auth, validateQuery('page'), (req, res) => {
    const { limit, cursor } = req.q;
    const rows = svc.listWeights(req.user.id, { limit: limit + 1, cursor });
    res.respond(200, buildPage(req, res, rows, limit, (w) => [w.loggedOn, w.id]));
  });
  r.post('/weights', auth, idem, validateBody('weightCreate'), (req, res) => {
    const w = svc.createWeight(req.user.id, req.body);
    nosql.logActivity(req.user.id, 'weight_logged', { weightKg: w.weightKg });
    res.set('Location', `/v1/weights/${w.id}`);
    res.respond(201, w);
  });
  r.delete('/weights/:id', auth, (req, res) => {
    if (!svc.deleteWeight(req.user.id, parseId(req.params.id))) throw new AppError(404, 'NOT_FOUND', 'Weight entry not found');
    res.respond(204);
  });

  r.get('/goals', auth, (req, res) => res.respond(200, svc.getGoal(req.user.id)));
  r.put('/goals', auth, validateBody('goalPut'), (req, res) => {
    const { goal, created } = svc.putGoal(req.user.id, req.body);
    res.respond(created ? 201 : 200, goal);
  });

  r.get('/summaries/daily', auth, validateQuery('summary'), (req, res) => {
    res.respond(200, svc.dailySummary(req.user.id, req.q.date));
  });
  return r;
};
