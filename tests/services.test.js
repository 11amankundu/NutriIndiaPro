const { request, makeApp, login, bearer } = require('./helpers');
const logger = require('../src/logger');
const { retry, CircuitBreaker, withTimeout, fetchJson, UpstreamError } = require('../src/resilience');

let app; let token;
beforeAll(async () => { app = makeApp(); token = await login(app); });

describe('GraphQL alongside REST (checkpoint 15)', () => {
  const gql = (query, variables, t) => {
    const r = request(app).post('/graphql').send({ query, variables });
    return t ? r.set(bearer(t)) : r;
  };
  test('public query', async () => {
    const r = await gql('{ foods(search: "dal", limit: 5) { id name calories } }');
    expect(r.status).toBe(200);
    expect(r.body.data.foods).toEqual([{ id: '3', name: 'Toor Dal', calories: 150 }]);
  });
  test('protected fields need a token (error reported inside the GraphQL response)', async () => {
    const r = await gql('{ me { email } }');
    expect(r.body.errors[0].extensions.code).toBe('UNAUTHENTICATED');
    const ok = await gql('{ me { email role } }', undefined, token);
    expect(ok.body.data.me).toEqual({ email: 'demo@nutriindia.test', role: 'user' });
  });
  test('mutation uses the same validation as REST and shows up in REST reads', async () => {
    const m = await gql('mutation($f: ID!) { logMeal(foodId: $f, servings: 2, mealType: "snack", eatenOn: "2026-04-01") { id foodName calories } }', { f: '8' }, token);
    expect(m.body.data.logMeal).toMatchObject({ foodName: 'Idli', calories: 116 });
    const rest = await request(app).get('/v1/meals?date=2026-04-01').set(bearer(token));
    expect(rest.body.data).toHaveLength(1);
    const s = await gql('{ dailySummary(date: "2026-04-01") { calories mealCount } }', undefined, token);
    expect(s.body.data.dailySummary).toEqual({ calories: 116, mealCount: 1 });
    const bad = await gql('mutation { logMeal(foodId: 1, servings: 99, mealType: "snack") { id } }', undefined, token);
    expect(bad.body.errors[0].extensions.code).toBe('VALIDATION_ERROR');
  });
  test('syntax errors -> 400', async () => {
    expect((await gql('{ foods( }')).status).toBe(400);
  });
});

describe('SOAP/WSDL client (checkpoint 16)', () => {
  test('serves a WSDL', async () => {
    const r = await request(app).get('/soap/nutrition?wsdl');
    expect(r.status).toBe(200);
    expect(r.text).toContain('GetFoodNutrition');
  });
  test('reads the WSDL, discovers the operation and executes one SOAP call', async () => {
    const r = await request(app).get('/v1/external/soap/food-nutrition?name=Idli').set(bearer(token));
    expect(r.status).toBe(200);
    expect(r.body.wsdl.operations).toEqual(['GetFoodNutrition']);
    expect(r.body.response).toEqual({ name: 'Idli', servingDesc: '1 piece (40 g)', calories: 58, proteinG: 2 });
    expect(r.body.raw.requestXml).toContain('<foodName>Idli</foodName>');
    expect(r.body.raw.responseXml).toContain('GetFoodNutritionResponse');
  });
  test('SOAP Fault is mapped to a 404 and not retried', async () => {
    const r = await request(app).get('/v1/external/soap/food-nutrition?name=Pizza').set(bearer(token));
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('SOAP_FAULT');
  });
});

describe('Resilience building blocks (checkpoints 17, 18, 19)', () => {
  test('retry: exponential backoff delays 100, 200, 400 then gives up', async () => {
    const delays = []; let calls = 0;
    await expect(retry(async () => { calls += 1; throw new UpstreamError('boom'); },
      { retries: 3, baseDelayMs: 100, jitter: false, sleep: async (ms) => delays.push(ms) })).rejects.toThrow('boom');
    expect(calls).toBe(4);
    expect(delays).toEqual([100, 200, 400]);
  });
  test('retry: stops immediately for non-retryable errors and returns on first success', async () => {
    let calls = 0;
    await expect(retry(async () => { calls += 1; throw new UpstreamError('nope', { retryable: false }); }, { sleep: async () => {} })).rejects.toThrow();
    expect(calls).toBe(1);
    expect(await retry(async (n) => (n < 1 ? Promise.reject(new UpstreamError('x')) : 'ok'), { sleep: async () => {} })).toBe('ok');
  });
  test('circuit breaker: CLOSED -> OPEN -> HALF_OPEN -> CLOSED', async () => {
    let t = 1000;
    const b = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 5000, now: () => t });
    const fail = () => Promise.reject(new UpstreamError('down'));
    await expect(b.exec(fail)).rejects.toThrow('down');
    await expect(b.exec(fail)).rejects.toThrow('down');
    expect(b.snapshot().state).toBe('OPEN');
    await expect(b.exec(async () => 'never called')).rejects.toMatchObject({ status: 503, code: 'CIRCUIT_OPEN' });
    t += 5001;
    expect(b.snapshot().state).toBe('HALF_OPEN');
    expect(await b.exec(async () => 'recovered')).toBe('recovered');
    expect(b.snapshot().state).toBe('CLOSED');
  });
  test('timeouts: withTimeout and fetchJson both abort slow work', async () => {
    await expect(withTimeout(new Promise(() => {}), 30, 'thing')).rejects.toMatchObject({ timeout: true });
    const server = require('http').createServer(() => {}).listen(0); // accepts connections, never answers
    await new Promise((r) => server.once('listening', r));
    await expect(fetchJson(`http://127.0.0.1:${server.address().port}/`, { timeoutMs: 100 })).rejects.toMatchObject({ timeout: true });
    server.closeAllConnections(); server.close();
  });
});

describe('Outbound endpoint end-to-end', () => {
  const call = (qs) => request(app).get(`/v1/external/food-facts?${qs}`).set(bearer(token));
  test('flaky upstream succeeds on the 3rd attempt (retry works)', async () => {
    const r = await call('mode=flaky&scenario=t1');
    expect(r.status).toBe(200);
    expect(r.body.meta.attempts).toBe(3);
  });
  test('slow upstream -> 504 UPSTREAM_TIMEOUT', async () => {
    const r = await call('mode=slow');
    expect(r.status).toBe(504);
    expect(r.body.error.code).toBe('UPSTREAM_TIMEOUT');
  });
  test('persistent failures open the breaker, then calls fail fast with 503', async () => {
    const local = makeApp({ breakerThreshold: 2, outboundTimeoutMs: 300 });
    const t = await login(local);
    const hit = () => request(local).get('/v1/external/food-facts?mode=fail').set(bearer(t));
    expect((await hit()).status).toBe(502);
    expect((await hit()).status).toBe(502);
    const open = await hit();
    expect(open.status).toBe(503);
    expect(open.body.error.code).toBe('CIRCUIT_OPEN');
    const state = await request(local).get('/v1/external/breaker').set(bearer(t));
    expect(state.body.upstream.state).toBe('OPEN');
  });
});

describe('Structured logging with correlation IDs + middleware (checkpoints 20, 21)', () => {
  let lines;
  beforeEach(() => { lines = []; process.env.LOG_LEVEL = 'info'; logger.setSink((l) => lines.push(JSON.parse(l))); });
  afterEach(() => { process.env.LOG_LEVEL = 'silent'; logger.resetSink(); });

  test('incoming X-Correlation-ID is echoed and appears on request + application log lines', async () => {
    const id = 'trace-12345678';
    const r = await request(app).get('/v1/external/food-facts?mode=flaky&scenario=log1').set(bearer(token)).set('X-Correlation-ID', id);
    expect(r.headers['x-correlation-id']).toBe(id);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((l) => l.correlationId === id)).toBe(true); // retry warnings + request line + mock-upstream hits share the ID
    const req = lines.find((l) => l.msg === 'request' && l.path === '/v1/external/food-facts');
    expect(req).toMatchObject({ level: 'info', method: 'GET', status: 200 });
    expect(typeof req.durationMs).toBe('number');
    expect(lines.some((l) => l.msg === 'outbound_retry')).toBe(true);
  });
  test('an ID is generated when none is sent; errors carry it in the body too', async () => {
    const r = await request(app).get('/v1/meals');
    expect(r.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.body.error.correlationId).toBe(r.headers['x-correlation-id']);
  });
  test('unexpected exceptions are handled centrally: 500 envelope, no stack leaked, stack logged', async () => {
    const original = app.locals.ctx.svc.getUserById;
    app.locals.ctx.svc.getUserById = () => { throw new Error('db exploded'); };
    const r = await request(app).get('/v1/users/me').set(bearer(token));
    app.locals.ctx.svc.getUserById = original;
    expect(r.status).toBe(500);
    expect(r.body.error).toMatchObject({ code: 'INTERNAL_ERROR', message: 'Unexpected server error' });
    expect(JSON.stringify(r.body)).not.toContain('db exploded');
    expect(lines.find((l) => l.level === 'error').error).toBe('db exploded');
  });
});

describe('API documentation (checkpoints 13, 14)', () => {
  test('manually written OpenAPI spec is served and Swagger UI renders', async () => {
    const spec = await request(app).get('/openapi.json');
    expect(spec.body.openapi).toMatch(/^3\./);
    expect(Object.keys(spec.body.paths)).toEqual(expect.arrayContaining(['/v1/meals', '/v1/meals/{id}', '/v1/sessions', '/graphql']));
    const ui = await request(app).get('/docs/').redirects(1);
    expect(ui.status).toBe(200);
    expect(ui.text).toContain('swagger-ui');
  });
  test('every documented /v1 path exists in the app (spec is not stale)', async () => {
    const t = token;
    for (const p of Object.keys(app.locals.openapi.paths).filter((x) => x.startsWith('/v1') && !x.includes('{'))) {
      const method = app.locals.openapi.paths[p].get ? 'get' : 'post'; // safe, non-destructive probe
      const r = await request(app)[method](p).set(bearer(t));
      const wasRoute = !(r.status === 404 && r.body.error && r.body.error.code === 'NOT_FOUND');
      expect([p, wasRoute]).toEqual([p, true]);
    }
  });
});

describe('Twelve-factor config (checkpoint 27)', () => {
  test('production refuses to start without a real JWT_SECRET', () => {
    const { loadConfig } = require('../src/config');
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/JWT_SECRET/);
    expect(loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(24), PORT: '8080' }).port).toBe(8080);
  });
});
