// NoSQL document-store demo: schema-flexible recipes (nested documents) + an activity event log.
// Queries use MongoDB operators ($lte, $regex, array-contains) via the embedded NeDB engine.
const express = require('express');
const { AppError, wrap } = require("../errors");
const { validateBody, validateQuery } = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const toApi = ({ _id, ownerId, ...rest }) => ({ id: _id, ...rest });

module.exports = ({ cfg, db, nosql }) => {
  const r = express.Router();
  const auth = authenticate(cfg);
  const idem = require('../middleware/idempotency')(db);
  const validId = (id) => /^[A-Za-z0-9]{16}$/.test(id);

  r.post('/recipes', auth, idem, validateBody('recipeCreate'), wrap(async (req, res) => {
    const doc = await nosql.recipes.insertAsync({ ownerId: req.user.id, tags: [], steps: [], ...req.body, createdAt: new Date().toISOString() });
    nosql.logActivity(req.user.id, 'recipe_created', { title: doc.title });
    res.set('Location', `/v1/recipes/${doc._id}`);
    res.respond(201, toApi(doc));
  }));

  r.get('/recipes', auth, validateQuery('recipes'), wrap(async (req, res) => {
    const { tag, q, maxCalories, limit } = req.q;
    const query = { ownerId: req.user.id };
    if (tag) query.tags = tag; // matches documents whose tags array contains the value
    if (q) query.title = { $regex: new RegExp(escapeRegex(q), 'i') };
    if (maxCalories !== undefined) query.caloriesPerServing = { $lte: maxCalories };
    const docs = await nosql.recipes.findAsync(query).sort({ createdAt: -1 }).limit(limit);
    res.respond(200, { data: docs.map(toApi) });
  }));

  r.get('/recipes/:id', auth, wrap(async (req, res) => {
    const doc = validId(req.params.id) && await nosql.recipes.findOneAsync({ _id: req.params.id, ownerId: req.user.id });
    if (!doc) throw new AppError(404, 'NOT_FOUND', 'Recipe not found');
    res.respond(200, toApi(doc));
  }));

  r.delete('/recipes/:id', auth, wrap(async (req, res) => {
    const n = validId(req.params.id) ? await nosql.recipes.removeAsync({ _id: req.params.id, ownerId: req.user.id }, {}) : 0;
    if (!n) throw new AppError(404, 'NOT_FOUND', 'Recipe not found');
    res.respond(204);
  }));

  r.get('/activity', auth, validateQuery('page'), wrap(async (req, res) => {
    const docs = await nosql.activity.findAsync({ userId: req.user.id }).sort({ at: -1 }).limit(req.q.limit);
    res.respond(200, { data: docs.map(({ _id, userId, ...rest }) => ({ id: _id, ...rest })) });
  }));
  return r;
};
