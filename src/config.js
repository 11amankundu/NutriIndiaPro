// Twelve-factor config: everything comes from environment variables (.env in development).
require('dotenv').config({ quiet: true });

const int = (v, d) => (v === undefined || v === '' || Number.isNaN(parseInt(v, 10)) ? d : parseInt(v, 10));

function loadConfig(env = process.env) {
  const cfg = {
    env: env.NODE_ENV || 'development',
    port: int(env.PORT, 3000),
    jwtSecret: env.JWT_SECRET || 'dev-only-secret-change-me',
    jwtExpiresIn: env.JWT_EXPIRES_IN || '1h',
    bcryptRounds: int(env.BCRYPT_ROUNDS, 10),
    sqlitePath: env.SQLITE_PATH || './data/nutriindia.db',
    nosqlDir: env.NOSQL_DIR === undefined ? './data/nosql' : env.NOSQL_DIR,
    corsOrigins: (env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:8080')
      .split(',').map((s) => s.trim()).filter(Boolean),
    rateLimitMax: int(env.RATE_LIMIT_MAX, 100),
    rateLimitWindowMs: int(env.RATE_LIMIT_WINDOW_MS, 60000),
    outboundTimeoutMs: int(env.OUTBOUND_TIMEOUT_MS, 1500),
    retryAttempts: int(env.OUTBOUND_RETRIES, 2),
    retryBaseDelayMs: int(env.OUTBOUND_RETRY_BASE_MS, 150),
    breakerThreshold: int(env.BREAKER_THRESHOLD, 3),
    breakerResetMs: int(env.BREAKER_RESET_MS, 10000),
    upstreamBaseUrl: env.UPSTREAM_BASE_URL || '', // empty = call our own built-in mock upstream
    seedDemo: env.SEED_DEMO_DATA !== 'false',
    trustProxy: env.TRUST_PROXY ? int(env.TRUST_PROXY, 1) : false,
  };
  if (cfg.env === 'production' && (!env.JWT_SECRET || env.JWT_SECRET.length < 16)) {
    throw new Error('JWT_SECRET must be set (16+ characters) when NODE_ENV=production');
  }
  return cfg;
}

module.exports = { loadConfig };
