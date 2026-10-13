const { request, makeApp, login, bearer } = require('./helpers');

let app; let token; let adminToken;
beforeAll(async () => { app = makeApp(); token = await login(app); adminToken = await login(app, 'admin@nutriindia.test', 'Admin@123'); });

describe('CRUD with correct HTTP methods + resource URLs (checkpoints 1, 9, 10)', () => {
  let id;
  test('POST creates (201 + Location)', async () => {
    // the unversioned URL must not exist - everything lives under /v1
    expect((await request(app).post('/meals').set(bearer(token)).send({ foodId: 1, servings: 2, mealType: 'lunch' })).status).toBe(404);
    const v1 = await request(app).post('/v1/meals').set(bearer(token)).send({ foodId: 1, servings: 2, mealType: 'lunch' });
    expect(v1.status).toBe(201);
    expect(v1.headers.location).toMatch(/^\/v1\/meals\/\d+$/);
    expect(v1.body).toMatchObject({ foodName: 'Roti (Chapati)', servings: 2, calories: 208 });
    id = v1.body.id;
  });
  test('GET reads, PUT replaces, PATCH updates, DELETE removes', async () => {
    expect((await request(app).get(`/v1/meals/${id}`).set(bearer(token))).status).toBe(200);
    const put = await request(app).put(`/v1/meals/${id}`).set(bearer(token)).send({ foodId: 2, servings: 1, mealType: 'dinner' });
    expect(put.status).toBe(200);
    expect(put.body.foodName).toBe('Steamed Rice');
    const patch = await request(app).patch(`/v1/meals/${id}`).set(bearer(token)).send({ servings: 3 });
    expect(patch.status).toBe(200);
    expect(patch.body).toMatchObject({ servings: 3, foodName: 'Steamed Rice' });
    expect((await request(app).delete(`/v1/meals/${id}`).set(bearer(token))).status).toBe(204);
    expect((await request(app).get(`/v1/meals/${id}`).set(bearer(token))).status).toBe(404);
  });
  test('URL paths contain no verbs (OpenAPI paths are nouns)', () => {
    const verbs = /^(get|create|add|update|delete|remove|login|logout|register|signup|set|fetch|list)/i;
    const segments = Object.keys(app.locals.openapi.paths).flatMap((p) => p.split('/')).filter((s) => s && !s.startsWith('{'));
    expect(segments.filter((s) => verbs.test(s))).toEqual([]);
  });
});

describe('Status codes + consistent error format (checkpoints 2, 3)', () => {
  test('at least 8 distinct status codes are produced', async () => {
    const seen = new Set();
    const hit = async (p) => { const r = await p; seen.add(r.status); return r; };
    await hit(request(app).get('/health')); // 200
    await hit(request(app).post('/v1/users').send({ email: 'codes@example.com', password: 'Secret123', name: 'Codes' })); // 201
    const m = await hit(request(app).post('/v1/meals').set(bearer(token)).send({ foodId: 1, servings: 1, mealType: 'snack' }));
    await hit(request(app).delete(`/v1/meals/${m.body.id}`).set(bearer(token))); // 204
    const f = await hit(request(app).get('/v1/foods?limit=1'));
    await hit(request(app).get('/v1/foods?limit=1').set('If-None-Match', f.headers.etag)); // 304
    await hit(request(app).post('/v1/meals').send({})); // 401
    await hit(request(app).post('/v1/meals').set(bearer(token)).send({ foodId: 'x' })); // 422
    await hit(request(app).post('/v1/foods').set(bearer(token)).send({})); // 403
    await hit(request(app).get('/v1/meals/99999').set(bearer(token))); // 404
    await hit(request(app).post('/v1/users').send({ email: 'demo@nutriindia.test', password: 'Secret123', name: 'Dup' })); // 409
    await hit(request(app).post('/v1/meals').set(bearer(token)).set('Content-Type', 'application/json').send('{bad json')); // 400
    await hit(request(app).get('/v1/foods').set('Accept', 'text/html')); // 406
    await hit(request(app).post('/v1/meals').set(bearer(token)).set('Content-Type', 'text/plain').send('hello')); // 415
    expect(seen.size).toBeGreaterThanOrEqual(8);
    expect([...seen]).toEqual(expect.arrayContaining([200, 201, 204, 304, 400, 401, 403, 404, 406, 409, 415, 422]));
  });

  test.each([
    ['401', () => request(app).get('/v1/meals')],
    ['404', () => request(app).get('/v1/nothing')],
    ['422', () => request(app).post('/v1/meals').set(bearer(token)).send({ foodId: 1 })],
    ['400', () => request(app).get('/v1/meals?cursor=garbage').set(bearer(token))],
  ])('error %s uses the same envelope', async (_, call) => {
    const r = await call();
    expect(r.body.error).toEqual(expect.objectContaining({
      status: r.status, code: expect.any(String), message: expect.any(String), correlationId: expect.any(String),
    }));
  });

  test('validation errors list every failing field', async () => {
    const r = await request(app).post('/v1/meals').set(bearer(token)).send({ foodId: 0, servings: -1, mealType: 'brunch', extra: 1 });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
    expect(r.body.error.details.length).toBeGreaterThanOrEqual(4);
  });
});

describe('Tracking resources', () => {
  test('goals: PUT creates (201) then replaces (200); daily summary reflects meals + goals', async () => {
    await request(app).post('/v1/users').send({ email: 'fresh@example.com', password: 'Secret123', name: 'Fresh' });
    const t = await login(app, 'fresh@example.com', 'Secret123');
    expect((await request(app).get('/v1/goals').set(bearer(t))).body.isDefault).toBe(true);
    expect((await request(app).put('/v1/goals').set(bearer(t)).send({ dailyCalories: 1800, dailyProteinG: 70 })).status).toBe(201);
    expect((await request(app).put('/v1/goals').set(bearer(t)).send({ dailyCalories: 1900, dailyProteinG: 75, targetWeightKg: 65 })).status).toBe(200);
    await request(app).post('/v1/meals').set(bearer(t)).send({ foodId: 3, servings: 2, mealType: 'lunch', eatenOn: '2026-01-05' }); // Toor Dal x2 = 300 kcal, 18 g
    await request(app).post('/v1/weights').set(bearer(t)).send({ weightKg: 64.5, loggedOn: '2026-01-05' });
    const s = await request(app).get('/v1/summaries/daily?date=2026-01-05').set(bearer(t));
    expect(s.body).toMatchObject({ calories: 300, proteinG: 18, goalCalories: 1900, remainingCalories: 1600, mealCount: 1, latestWeightKg: 64.5 });
  });
  test('profile PATCH', async () => {
    const r = await request(app).patch('/v1/users/me').set(bearer(token)).send({ age: 30, heightCm: 172 });
    expect(r.body).toMatchObject({ age: 30, heightCm: 172, email: 'demo@nutriindia.test' });
  });
});
