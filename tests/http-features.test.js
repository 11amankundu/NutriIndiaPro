const { request, makeApp, login, bearer } = require('./helpers');

let app; let token;
beforeAll(async () => { app = makeApp(); token = await login(app); });

describe('Idempotency-Key (checkpoint 4)', () => {
  test('same key + same body replays the first response, creates one row', async () => {
    const send = () => request(app).post('/v1/meals').set(bearer(token)).set('Idempotency-Key', 'key-abc-123')
      .send({ foodId: 8, servings: 1, mealType: 'breakfast', eatenOn: '2026-02-01' });
    const a = await send(); const b = await send();
    expect(a.status).toBe(201); expect(b.status).toBe(201);
    expect(b.body.id).toBe(a.body.id);
    expect(b.headers['idempotent-replayed']).toBe('true');
    expect(a.headers['idempotent-replayed']).toBeUndefined();
    const list = await request(app).get('/v1/meals?date=2026-02-01').set(bearer(token));
    expect(list.body.data).toHaveLength(1);
  });
  test('same key with a different body is rejected (422)', async () => {
    const r = await request(app).post('/v1/meals').set(bearer(token)).set('Idempotency-Key', 'key-abc-123')
      .send({ foodId: 9, servings: 5, mealType: 'dinner', eatenOn: '2026-02-01' });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });
});

describe('ETag / 304 and Cache-Control (checkpoints 5, 6)', () => {
  test('GET has ETag + Cache-Control; matching If-None-Match gives 304 with no body', async () => {
    const first = await request(app).get('/v1/foods?limit=3');
    expect(first.status).toBe(200);
    expect(first.headers.etag).toMatch(/^"/);
    expect(first.headers['cache-control']).toBe('public, max-age=300');
    const second = await request(app).get('/v1/foods?limit=3').set('If-None-Match', first.headers.etag);
    expect(second.status).toBe(304);
    expect(second.text).toBe('');
    const changed = await request(app).get('/v1/foods?limit=4').set('If-None-Match', first.headers.etag);
    expect(changed.status).toBe(200);
  });
  test('private data is cached privately; errors are never cached', async () => {
    const r = await request(app).get('/v1/meals').set(bearer(token));
    expect(r.headers['cache-control']).toMatch(/^private/);
    const e = await request(app).get('/v1/meals');
    expect(e.headers['cache-control']).toBe('no-store');
  });
});

describe('Content negotiation (checkpoint 8)', () => {
  test('JSON by default, XML on request, 406 otherwise', async () => {
    const json = await request(app).get('/v1/foods/1');
    expect(json.headers['content-type']).toMatch(/application\/json/);
    const xml = await request(app).get('/v1/foods/1').set('Accept', 'application/xml');
    expect(xml.status).toBe(200);
    expect(xml.headers['content-type']).toMatch(/application\/xml/);
    expect(xml.text).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?><response><id>1<\/id><name>Roti \(Chapati\)<\/name>/);
    expect(xml.headers.vary).toMatch(/Accept/);
    expect((await request(app).get('/v1/foods/1').set('Accept', 'text/html')).status).toBe(406);
  });
  test('errors are negotiated too', async () => {
    const r = await request(app).get('/v1/foods/9999').set('Accept', 'application/xml');
    expect(r.status).toBe(404);
    expect(r.text).toContain('<error><status>404</status><code>NOT_FOUND</code>');
  });
});

describe('Cursor pagination (checkpoint 11)', () => {
  test('walks all pages via page.next and the Link header with no duplicates', async () => {
    await request(app).post('/v1/users').send({ email: 'pager@example.com', password: 'Secret123', name: 'Pager' });
    const t = await login(app, 'pager@example.com', 'Secret123');
    for (let i = 0; i < 7; i++) {
      await request(app).post('/v1/meals').set(bearer(t)).send({ foodId: 1 + i, servings: 1, mealType: 'snack', eatenOn: '2026-03-0' + (1 + (i % 3)) });
    }
    const ids = [];
    let url = '/v1/meals?limit=3'; let pages = 0;
    while (url) {
      const r = await request(app).get(url).set(bearer(t));
      expect(r.status).toBe(200);
      ids.push(...r.body.data.map((m) => m.id));
      expect(r.body.page.limit).toBe(3);
      if (r.body.page.next) expect(r.headers.link).toBe(`<${r.body.page.next}>; rel="next"`);
      else expect(r.headers.link).toBeUndefined();
      url = r.body.page.next; pages += 1;
    }
    expect(pages).toBe(3);
    expect(ids).toHaveLength(7);
    expect(new Set(ids).size).toBe(7);
  });
  test('tampered cursor -> 400', async () => {
    const r = await request(app).get('/v1/foods?cursor=not-a-cursor');
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INVALID_CURSOR');
  });
});

describe('Rate limiting (checkpoint 12)', () => {
  test('headers on every response, 429 + Retry-After when exceeded', async () => {
    const limited = makeApp({ rateLimitMax: 3, rateLimitWindowMs: 60000 });
    const codes = [];
    let last;
    for (let i = 0; i < 5; i++) { last = await request(limited).get('/v1/foods'); codes.push(last.status); }
    expect(codes).toEqual([200, 200, 200, 429, 429]);
    expect(last.headers['ratelimit-limit']).toBe('3');
    expect(last.headers['ratelimit-remaining']).toBe('0');
    expect(Number(last.headers['retry-after'])).toBeGreaterThan(0);
    expect(last.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('CORS (checkpoint 25)', () => {
  test('allow-listed origin gets preflight approval with explicit methods/headers', async () => {
    const r = await request(app).options('/v1/meals').set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'POST').set('Access-Control-Request-Headers', 'authorization,content-type');
    expect(r.status).toBe(204);
    expect(r.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(r.headers['access-control-allow-methods']).toBe('GET,POST,PUT,PATCH,DELETE,OPTIONS');
    expect(r.headers['access-control-allow-headers']).toMatch(/Idempotency-Key/);
    expect(r.headers['access-control-allow-credentials']).toBeUndefined();
    expect(r.headers.vary).toMatch(/Origin/);
  });
  test('unknown origin is refused and receives no CORS headers', async () => {
    const pre = await request(app).options('/v1/meals').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'GET');
    expect(pre.status).toBe(403);
    expect(pre.headers['access-control-allow-origin']).toBeUndefined();
    const simple = await request(app).get('/v1/foods').set('Origin', 'https://evil.example');
    expect(simple.headers['access-control-allow-origin']).toBeUndefined();
  });
  test('exposed headers let browsers read ETag, Link, rate-limit info', async () => {
    const r = await request(app).get('/v1/foods').set('Origin', 'http://localhost:3000');
    expect(r.headers['access-control-expose-headers']).toMatch(/ETag.*Link.*RateLimit-Remaining/);
  });
});
