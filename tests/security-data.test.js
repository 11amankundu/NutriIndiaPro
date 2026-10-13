const { request, makeApp, login, bearer } = require('./helpers');

let app; let user; let admin;
beforeAll(async () => { app = makeApp(); user = await login(app); admin = await login(app, 'admin@nutriindia.test', 'Admin@123'); });

describe('JWT authentication + RBAC (checkpoint 24)', () => {
  test('login returns a JWT; protected routes reject missing/invalid/tampered tokens', async () => {
    expect(user.split('.')).toHaveLength(3);
    const none = await request(app).get('/v1/users/me');
    expect(none.status).toBe(401);
    expect(none.headers['www-authenticate']).toBe('Bearer');
    expect((await request(app).get('/v1/users/me').set(bearer('abc.def.ghi'))).body.error.code).toBe('INVALID_TOKEN');
    expect((await request(app).get('/v1/users/me').set(bearer(user.slice(0, -2) + 'xx'))).status).toBe(401);
    expect((await request(app).get('/v1/users/me').set(bearer(user))).body.email).toBe('demo@nutriindia.test');
  });
  test('wrong password -> 401 INVALID_CREDENTIALS (same answer for unknown email)', async () => {
    const a = await request(app).post('/v1/sessions').send({ email: 'demo@nutriindia.test', password: 'wrong-password' });
    const b = await request(app).post('/v1/sessions').send({ email: 'nobody@example.com', password: 'whatever1' });
    expect([a.status, b.status]).toEqual([401, 401]);
    expect(a.body.error.code).toBe(b.body.error.code);
  });
  test('roles: user -> 403 on admin endpoints, admin -> allowed', async () => {
    expect((await request(app).get('/v1/users').set(bearer(user))).status).toBe(403);
    expect((await request(app).get('/v1/users').set(bearer(admin))).status).toBe(200);
    const food = { name: 'Test Thali', servingDesc: '1 plate', calories: 500, proteinG: 15, carbsG: 70, fatG: 15 };
    expect((await request(app).post('/v1/foods').set(bearer(user)).send(food)).status).toBe(403);
    const created = await request(app).post('/v1/foods').set(bearer(admin)).send(food);
    expect(created.status).toBe(201);
    expect((await request(app).post('/v1/foods').set(bearer(admin)).send(food)).status).toBe(409);
    expect((await request(app).patch(`/v1/foods/${created.body.id}`).set(bearer(admin)).send({ calories: 450 })).body.calories).toBe(450);
    expect((await request(app).delete(`/v1/foods/${created.body.id}`).set(bearer(admin))).status).toBe(204);
  });
  test('users can only see their own meals', async () => {
    await request(app).post('/v1/users').send({ email: 'other@example.com', password: 'Secret123', name: 'Other' });
    const other = await login(app, 'other@example.com', 'Secret123');
    const mine = await request(app).post('/v1/meals').set(bearer(user)).send({ foodId: 1, servings: 1, mealType: 'lunch' });
    expect((await request(app).get(`/v1/meals/${mine.body.id}`).set(bearer(other))).status).toBe(404);
    expect((await request(app).delete(`/v1/meals/${mine.body.id}`).set(bearer(other))).status).toBe(404);
  });
});

describe('AJV validation (checkpoint 7)', () => {
  test('rejects bad email, short password, unknown properties', async () => {
    const r = await request(app).post('/v1/users').send({ email: 'not-an-email', password: '123', name: 'X', admin: true });
    expect(r.status).toBe(422);
    const keywords = r.body.error.details.map((d) => d.keyword);
    expect(keywords).toEqual(expect.arrayContaining(['format', 'minLength', 'additionalProperties']));
  });
  test('users cannot self-assign the admin role', async () => {
    expect((await request(app).post('/v1/users').send({ email: 'sneaky@example.com', password: 'Secret123', name: 'S', role: 'admin' })).status).toBe(422);
  });
  test('query parameters are validated and coerced', async () => {
    expect((await request(app).get('/v1/foods?limit=500')).status).toBe(422);
    expect((await request(app).get('/v1/foods?limit=2')).body.data).toHaveLength(2);
  });
});

describe('SQL database with parameterized queries (checkpoint 22)', () => {
  test('SQL injection strings are treated as data', async () => {
    const q = encodeURIComponent("' OR '1'='1' --");
    const r = await request(app).get(`/v1/foods?q=${q}`);
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(0);
    const drop = await request(app).post('/v1/sessions').send({ email: "x'; DROP TABLE users; --", password: 'whatever1' });
    expect(drop.status).toBe(401);
    expect((await request(app).get('/v1/users').set(bearer(admin))).body.data.length).toBeGreaterThanOrEqual(2); // table still there
  });
  test('LIKE wildcards in search are escaped', async () => {
    expect((await request(app).get('/v1/foods?q=%25')).body.data).toHaveLength(0);
    expect((await request(app).get('/v1/foods?q=dal')).body.data.map((f) => f.name)).toEqual(['Toor Dal']);
  });
  test('foreign keys: cannot delete a food that meals reference (409)', async () => {
    expect((await request(app).delete('/v1/foods/1').set(bearer(admin))).status).toBe(409);
  });
});

describe('NoSQL document store (checkpoint 23)', () => {
  test('stores nested recipe documents and queries them with Mongo-style operators', async () => {
    const mk = (title, tags, cal) => request(app).post('/v1/recipes').set(bearer(user))
      .send({ title, tags, caloriesPerServing: cal, ingredients: [{ name: 'dal', quantity: '1 cup' }, { name: 'ghee', quantity: '1 tsp' }] });
    expect((await mk('Dal Tadka', ['vegetarian', 'protein'], 220)).status).toBe(201);
    await mk('Chicken Biryani', ['non-veg'], 480);
    await mk('Moong Khichdi', ['vegetarian'], 300);
    const veg = await request(app).get('/v1/recipes?tag=vegetarian').set(bearer(user));
    expect(veg.body.data.map((r) => r.title).sort()).toEqual(['Dal Tadka', 'Moong Khichdi']);
    const light = await request(app).get('/v1/recipes?maxCalories=250').set(bearer(user));
    expect(light.body.data.map((r) => r.title)).toEqual(['Dal Tadka']);
    const search = await request(app).get('/v1/recipes?q=BIRYANI').set(bearer(user));
    expect(search.body.data).toHaveLength(1);
    expect(search.body.data[0].ingredients[0]).toEqual({ name: 'dal', quantity: '1 cup' });
    const id = search.body.data[0].id;
    expect((await request(app).get(`/v1/recipes/${id}`).set(bearer(user))).status).toBe(200);
    expect((await request(app).delete(`/v1/recipes/${id}`).set(bearer(user))).status).toBe(204);
    expect((await request(app).get(`/v1/recipes/${id}`).set(bearer(user))).status).toBe(404);
  });
  test('activity log documents are written as a side effect of API calls', async () => {
    await request(app).post('/v1/meals').set(bearer(user)).send({ foodId: 4, servings: 1, mealType: 'dinner' });
    const a = await request(app).get('/v1/activity?limit=5').set(bearer(user));
    expect(a.body.data.map((e) => e.type)).toEqual(expect.arrayContaining(['meal_logged', 'recipe_created']));
  });
});
