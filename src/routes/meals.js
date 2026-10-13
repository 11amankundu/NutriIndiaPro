// Meals: full CRUD scoped to the authenticated user (POST create, GET read, PUT replace, PATCH update, DELETE remove).
const express = require('express');
const { AppError, parseId } = require('../errors');
const { validateBody, validateQuery } = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { buildPage } = require('../pagination');

module.exports = ({ cfg, db, svc, nosql }) => {
  const r = express.Router();
  r.use('/meals', authenticate(cfg));
  const idem = require('../middleware/idempotency')(db);
  const found = (m) => { if (!m) throw new AppError(404, 'NOT_FOUND', 'Meal not found'); return m; };
  const foodMustExist = (foodId) => {
    if (foodId !== undefined && !svc.getFood(foodId)) throw new AppError(422, 'FOOD_NOT_FOUND', `foodId ${foodId} does not exist`);
  };

  r.get('/meals', validateQuery('meals'), (req, res) => {
    const { date, limit, cursor } = req.q;
    const rows = svc.listMeals(req.user.id, { date, limit: limit + 1, cursor });
    res.respond(200, buildPage(req, res, rows, limit, (m) => [m.eatenOn, m.id]));
  });

  r.post('/meals', idem, validateBody('mealCreate'), (req, res) => {
    foodMustExist(req.body.foodId);
    const meal = svc.createMeal(req.user.id, req.body);
    nosql.logActivity(req.user.id, 'meal_logged', { mealId: meal.id, food: meal.foodName });
    res.set('Location', `/v1/meals/${meal.id}`);
    res.respond(201, meal);
  });

  r.get('/meals/:id', (req, res) => res.respond(200, found(svc.getMeal(req.user.id, parseId(req.params.id)))));

  r.put('/meals/:id', validateBody('mealCreate'), (req, res) => {
    const id = parseId(req.params.id);
    found(svc.getMeal(req.user.id, id));
    foodMustExist(req.body.foodId);
    res.respond(200, svc.updateMeal(req.user.id, id, { eatenOn: svc.todayIso(), ...req.body }));
  });

  r.patch('/meals/:id', validateBody('mealPatch'), (req, res) => {
    const id = parseId(req.params.id);
    found(svc.getMeal(req.user.id, id));
    foodMustExist(req.body.foodId);
    res.respond(200, svc.updateMeal(req.user.id, id, req.body));
  });

  r.delete('/meals/:id', (req, res) => {
    if (!svc.deleteMeal(req.user.id, parseId(req.params.id))) throw new AppError(404, 'NOT_FOUND', 'Meal not found');
    nosql.logActivity(req.user.id, 'meal_deleted', { mealId: parseId(req.params.id) });
    res.respond(204);
  });
  return r;
};
