const path = require('path');
const fs = require('fs');
const express = require('express');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yaml');

const { loadConfig } = require('./config');
const { createDb } = require('./db');
const { seedFoods, seedDemo } = require('./seed');
const { createNosql } = require('./nosql');
const { createServices } = require('./services');
const { CircuitBreaker } = require('./resilience');
const { mountSoapService } = require('./soap');
const { graphqlHandler } = require('./graphql');
const { wrap } = require('./errors');
const correlation = require('./middleware/correlation');
const { negotiate, requireAcceptable, requireJsonBody } = require('./middleware/negotiate');
const cors = require('./middleware/cors');
const rateLimit = require('./middleware/rateLimit');
const { errorHandler, notFound } = require('./middleware/errorHandler');

function createApp(overrides = {}) {
  const cfg = { ...loadConfig(), ...overrides };
  const db = createDb(cfg.sqlitePath);
  seedFoods(db);
  if (cfg.seedDemo) seedDemo(db, cfg);
  const svc = createServices(db);
  const nosql = createNosql(cfg.nosqlDir);
  const breakerOpts = { failureThreshold: cfg.breakerThreshold, resetTimeoutMs: cfg.breakerResetMs };
  const ctx = {
    cfg, db, svc, nosql,
    upstreamBreaker: new CircuitBreaker({ name: 'upstream-rest', ...breakerOpts }),
    soapBreaker: new CircuitBreaker({ name: 'upstream-soap', ...breakerOpts }),
  };

  const app = express();
  app.locals.ctx = ctx;
  app.disable('x-powered-by');
  app.set('etag', false); // we generate ETags ourselves (middleware/negotiate.js)
  app.set('trust proxy', cfg.trustProxy);

  // (20) middleware pipeline
  app.use(correlation());
  app.use(negotiate());
  app.use(cors(cfg));
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (req, res) => res.respond(200, { status: 'ok', env: cfg.env, uptimeSeconds: Math.round(process.uptime()) }, { cacheControl: 'no-store' }));

  // (13/14) manually written OpenAPI spec + Swagger UI
  const specText = fs.readFileSync(path.join(__dirname, '..', 'openapi.yaml'), 'utf8');
  const spec = YAML.parse(specText);
  app.get('/openapi.yaml', (req, res) => res.type('application/yaml').send(specText));
  app.get('/openapi.json', (req, res) => res.json(spec));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(spec, { customSiteTitle: 'NutriIndia Pro API' }));
  app.locals.openapi = spec;

  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.use('/mock/upstream', require('./routes/mockUpstream')());
  mountSoapService(app, svc);

  const limiter = rateLimit({ max: cfg.rateLimitMax, windowMs: cfg.rateLimitWindowMs });
  const gql = wrap(graphqlHandler(ctx));
  app.get('/graphql', limiter, gql);
  app.post('/graphql', limiter, gql);

  // (10) every REST resource lives under /v1
  const v1 = express.Router();
  v1.use(limiter, requireAcceptable, requireJsonBody);
  v1.use(require('./routes/users')(ctx));
  v1.use(require('./routes/foods')(ctx));
  v1.use(require('./routes/meals')(ctx));
  v1.use(require('./routes/tracking')(ctx));
  v1.use(require('./routes/documents')(ctx));
  v1.use(require('./routes/external')(ctx));
  app.use('/v1', v1);

  app.use(notFound);
  app.use(errorHandler());
  return app;
}

module.exports = { createApp };
