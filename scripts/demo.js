// Walks through the checkpoints against a RUNNING server and prints what happened.
//   npm start            (terminal 1)
//   npm run demo         (terminal 2)       or:  $env:BASE_URL="https://your-app.onrender.com"; npm run demo
const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
let token = '';

async function call(label, path, { method = 'GET', body, headers = {}, auth = true } = {}) {
  const h = { Accept: 'application/json', ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (auth && token) h.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (_) { json = text; }
  console.log(`${String(res.status).padEnd(4)}${method.padEnd(7)}${path.slice(0, 60).padEnd(62)}${label}`);
  return { res, json, text };
}

(async () => {
  console.log(`\nNutriIndia Pro demo against ${BASE}\n`);
  const login = await call('log in (JWT)', '/v1/sessions', { method: 'POST', auth: false, body: { email: 'demo@nutriindia.test', password: 'Demo@1234' } });
  if (!login.json.accessToken) throw new Error('Login failed - is the server running with SEED_DEMO_DATA=true?');
  token = login.json.accessToken;

  const foods = await call('public GET: ETag + Cache-Control', '/v1/foods?limit=3', { auth: false });
  console.log(`      ETag=${foods.res.headers.get('etag')}  Cache-Control=${foods.res.headers.get('cache-control')}`);
  await call('conditional GET -> 304', '/v1/foods?limit=3', { auth: false, headers: { 'If-None-Match': foods.res.headers.get('etag') } });
  const xml = await call('content negotiation (XML)', '/v1/foods/1', { auth: false, headers: { Accept: 'application/xml' } });
  console.log(`      ${xml.text.slice(0, 110)}...`);
  await call('406 Not Acceptable', '/v1/foods/1', { auth: false, headers: { Accept: 'text/html' } });

  const key = `demo-${Date.now()}`;
  const meal = { foodId: 1, servings: 2, mealType: 'snack' };
  const m1 = await call('POST meal with Idempotency-Key', '/v1/meals', { method: 'POST', headers: { 'Idempotency-Key': key }, body: meal });
  const m2 = await call('same key again -> replayed response', '/v1/meals', { method: 'POST', headers: { 'Idempotency-Key': key }, body: meal });
  console.log(`      Idempotent-Replayed=${m2.res.headers.get('idempotent-replayed')}  same id: ${m1.json.id === m2.json.id}`);
  await call('PATCH meal', `/v1/meals/${m1.json.id}`, { method: 'PATCH', body: { servings: 3 } });
  await call('DELETE meal', `/v1/meals/${m1.json.id}`, { method: 'DELETE' });

  const page = await call('cursor pagination (limit=2)', '/v1/meals?limit=2');
  console.log(`      page.next = ${page.json.page.next}`);
  if (page.json.page.next) await call('follow page.next', page.json.page.next);

  await call('401 no token', '/v1/meals', { auth: false });
  await call('403 user on admin route', '/v1/users');
  await call('422 AJV validation', '/v1/meals', { method: 'POST', body: { foodId: 'x' } });
  await call('404 unknown resource', '/v1/meals/999999');
  await call('daily summary', '/v1/summaries/daily');

  const g = await call('GraphQL query', '/graphql', { method: 'POST', body: { query: '{ foods(search:"dal"){ name calories } }' }, auth: false });
  console.log(`      ${JSON.stringify(g.json)}`);
  const soap = await call('SOAP: read WSDL + call GetFoodNutrition', '/v1/external/soap/food-nutrition?name=Idli');
  console.log(`      operations=${JSON.stringify(soap.json.wsdl.operations)} response=${JSON.stringify(soap.json.response)}`);

  const flaky = await call('retry w/ backoff (flaky upstream)', `/v1/external/food-facts?mode=flaky&scenario=${key}`);
  console.log(`      attempts used: ${flaky.json.meta.attempts}`);
  await call('timeout -> 504', '/v1/external/food-facts?mode=slow');
  for (let i = 1; i <= 4; i++) await call(`failing upstream #${i} (breaker opens at threshold)`, '/v1/external/food-facts?mode=fail');
  const br = await call('breaker state', '/v1/external/breaker');
  console.log(`      upstream breaker: ${br.json.upstream.state}`);

  const hdr = await call('rate-limit headers + correlation id', '/v1/foods/1', { auth: false });
  console.log(`      RateLimit-Remaining=${hdr.res.headers.get('ratelimit-remaining')}  X-Correlation-ID=${hdr.res.headers.get('x-correlation-id')}`);
  console.log('\nDone. Swagger UI: ' + BASE + '/docs\n');
})().catch((e) => { console.error('\nDemo failed:', e.message); process.exit(1); });
