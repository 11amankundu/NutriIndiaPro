// AJV JSON Schemas (draft-07). Body schemas are strict (no coercion, no extra properties);
// query schemas coerce strings -> numbers because query strings are always text.
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
const ajvQuery = new Ajv({ allErrors: true, coerceTypes: true, useDefaults: true, allowUnionTypes: true });
addFormats(ajv);
addFormats(ajvQuery);

const MEAL_TYPES = ['breakfast', 'lunch', 'snack', 'dinner'];
const str = (min, max) => ({ type: 'string', minLength: min, maxLength: max });
const date = { type: 'string', format: 'date' };
const obj = (required, properties, extra = {}) => ({ type: 'object', required, properties, additionalProperties: false, ...extra });

const mealProps = {
  foodId: { type: 'integer', minimum: 1 },
  servings: { type: 'number', exclusiveMinimum: 0, maximum: 20 },
  mealType: { type: 'string', enum: MEAL_TYPES },
  eatenOn: date,
};
const foodProps = {
  name: str(1, 80),
  servingDesc: str(1, 80),
  calories: { type: 'number', minimum: 0, maximum: 3000 },
  proteinG: { type: 'number', minimum: 0, maximum: 300 },
  carbsG: { type: 'number', minimum: 0, maximum: 500 },
  fatG: { type: 'number', minimum: 0, maximum: 300 },
};
const limit = { type: 'integer', minimum: 1, maximum: 50, default: 10 };
const cursor = { type: 'string', maxLength: 300 };

const bodySchemas = {
  userCreate: obj(['email', 'password', 'name'], {
    email: { type: 'string', format: 'email', maxLength: 120 },
    password: str(8, 72),
    name: str(1, 80),
  }),
  sessionCreate: obj(['email', 'password'], { email: str(3, 120), password: str(1, 72) }),
  userPatch: obj([], {
    name: str(1, 80),
    age: { type: 'integer', minimum: 5, maximum: 120 },
    heightCm: { type: 'number', minimum: 50, maximum: 260 },
  }, { minProperties: 1 }),
  foodInput: obj(Object.keys(foodProps), foodProps),
  foodPatch: obj([], foodProps, { minProperties: 1 }),
  mealCreate: obj(['foodId', 'servings', 'mealType'], mealProps),
  mealPatch: obj([], mealProps, { minProperties: 1 }),
  weightCreate: obj(['weightKg'], { weightKg: { type: 'number', minimum: 20, maximum: 400 }, loggedOn: date }),
  goalPut: obj(['dailyCalories', 'dailyProteinG'], {
    dailyCalories: { type: 'integer', minimum: 500, maximum: 10000 },
    dailyProteinG: { type: 'number', minimum: 0, maximum: 500 },
    targetWeightKg: { type: ['number', 'null'], minimum: 20, maximum: 400 },
  }),
  recipeCreate: obj(['title', 'ingredients'], {
    title: str(1, 100),
    ingredients: {
      type: 'array', minItems: 1, maxItems: 40,
      items: obj(['name', 'quantity'], { name: str(1, 60), quantity: str(1, 40) }),
    },
    tags: { type: 'array', maxItems: 10, items: str(1, 30) },
    steps: { type: 'array', maxItems: 30, items: str(1, 300) },
    caloriesPerServing: { type: 'number', minimum: 0, maximum: 3000 },
  }),
};

const querySchemas = {
  page: { type: 'object', properties: { limit, cursor } },
  foods: { type: 'object', properties: { limit, cursor, q: { type: 'string', maxLength: 50 } } },
  meals: { type: 'object', properties: { limit, cursor, date } },
  summary: { type: 'object', properties: { date } },
  recipes: {
    type: 'object',
    properties: {
      limit, tag: str(1, 30), q: { type: 'string', maxLength: 50 },
      maxCalories: { type: 'number', minimum: 0 },
    },
  },
  foodFacts: {
    type: 'object',
    properties: {
      name: { type: 'string', maxLength: 60, default: 'Roti' },
      mode: { type: 'string', enum: ['ok', 'fail', 'slow', 'flaky'], default: 'ok' },
      scenario: { type: 'string', maxLength: 60 },
    },
  },
  soapFood: { type: 'object', properties: { name: { type: 'string', minLength: 1, maxLength: 60, default: 'Roti (Chapati)' } } },
};

const validators = {};
for (const [k, s] of Object.entries(bodySchemas)) validators[k] = ajv.compile(s);
const queryValidators = {};
for (const [k, s] of Object.entries(querySchemas)) queryValidators[k] = ajvQuery.compile(s);

module.exports = { validators, queryValidators, MEAL_TYPES };
