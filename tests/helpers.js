const request = require('supertest');
const { createApp } = require('../src/app');

// Fresh isolated app per test file: in-memory SQLite + in-memory NoSQL store.
function makeApp(overrides = {}) {
  return createApp({
    sqlitePath: ':memory:', nosqlDir: '', rateLimitMax: 1000, bcryptRounds: 4,
    outboundTimeoutMs: 300, retryBaseDelayMs: 5, breakerResetMs: 60000, ...overrides,
  });
}

async function login(app, email = 'demo@nutriindia.test', password = 'Demo@1234') {
  const r = await request(app).post('/v1/sessions').send({ email, password });
  return r.body.accessToken;
}
const bearer = (t) => ({ Authorization: `Bearer ${t}` });

module.exports = { request, makeApp, login, bearer };
