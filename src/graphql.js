// GraphQL endpoint (POST /graphql) next to REST. Resolvers reuse the same service layer and AJV validators as REST.
const { buildSchema, graphql, GraphQLError } = require('graphql');
const { validators } = require('./schemas');
const { tryUser } = require('./middleware/auth');

const schema = buildSchema(`
  type User { id: ID!, email: String!, name: String!, role: String!, age: Int, heightCm: Float }
  type Food { id: ID!, name: String!, servingDesc: String!, calories: Float!, proteinG: Float!, carbsG: Float!, fatG: Float! }
  type Meal { id: ID!, foodId: ID!, foodName: String!, servings: Float!, mealType: String!, eatenOn: String!, calories: Float!, proteinG: Float! }
  type MealTypeTotal { mealType: String!, calories: Float! }
  type DailySummary {
    date: String!, calories: Float!, proteinG: Float!, carbsG: Float!, fatG: Float!, mealCount: Int!,
    goalCalories: Int!, goalProteinG: Float!, remainingCalories: Float!, caloriesPercent: Float!, proteinPercent: Float!,
    byMealType: [MealTypeTotal!]!, latestWeightKg: Float
  }
  type Query {
    foods(search: String, limit: Int = 10): [Food!]!
    food(id: ID!): Food
    me: User!
    meals(date: String, limit: Int = 20): [Meal!]!
    dailySummary(date: String): DailySummary!
  }
  type Mutation {
    logMeal(foodId: ID!, servings: Float = 1, mealType: String!, eatenOn: String): Meal!
  }
`);

const gqlError = (message, code, extra = {}) => new GraphQLError(message, { extensions: { code, ...extra } });

function buildRoot(svc) {
  const need = (ctx) => {
    if (!ctx.user) throw gqlError('Authentication required (send Authorization: Bearer <token>)', 'UNAUTHENTICATED');
    return ctx.user;
  };
  const clamp = (n) => Math.max(1, Math.min(50, n || 10));
  return {
    foods: ({ search, limit }) => svc.listFoods({ q: search, limit: clamp(limit) }),
    food: ({ id }) => svc.getFood(Number(id)) || null,
    me: (_, ctx) => svc.getUserById(need(ctx).id),
    meals: ({ date, limit }, ctx) => svc.listMeals(need(ctx).id, { date, limit: clamp(limit) }),
    dailySummary: ({ date }, ctx) => svc.dailySummary(need(ctx).id, date || undefined),
    logMeal: (args, ctx) => {
      const user = need(ctx);
      const input = { foodId: Number(args.foodId), servings: args.servings, mealType: args.mealType };
      if (args.eatenOn) input.eatenOn = args.eatenOn;
      if (!validators.mealCreate(input)) {
        throw gqlError('Validation failed', 'VALIDATION_ERROR', { details: validators.mealCreate.errors.map((e) => `${e.instancePath || '/'} ${e.message}`) });
      }
      if (!svc.getFood(input.foodId)) throw gqlError('Food not found', 'FOOD_NOT_FOUND');
      return svc.createMeal(user.id, input);
    },
  };
}

function graphqlHandler(ctx) {
  const rootValue = buildRoot(ctx.svc);
  return async (req, res) => {
    const src = req.method === 'GET' ? req.query : (req.body || {});
    if (typeof src.query !== 'string') {
      return res.status(400).json({ errors: [{ message: 'Provide a GraphQL "query" string', extensions: { code: 'BAD_REQUEST' } }] });
    }
    let variables = src.variables;
    if (typeof variables === 'string') {
      try { variables = JSON.parse(variables); } catch (_) { variables = undefined; }
    }
    const result = await graphql({
      schema,
      source: src.query,
      rootValue,
      contextValue: { user: tryUser(ctx.cfg, req) },
      variableValues: variables,
      operationName: src.operationName,
    });
    // Syntax/validation errors have no "data" -> 400; resolver errors keep HTTP 200 (GraphQL convention).
    return res.status(result.data === undefined ? 400 : 200).json(result);
  };
}

module.exports = { graphqlHandler };
