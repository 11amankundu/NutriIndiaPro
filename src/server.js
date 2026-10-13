const { createApp } = require('./app');
const logger = require('./logger');

const app = createApp();
const { cfg, db } = app.locals.ctx;
const server = app.listen(cfg.port, () => logger.info('server_started', { port: cfg.port, env: cfg.env, docs: `http://localhost:${cfg.port}/docs` }));

function shutdown(signal) {
  logger.info('shutdown', { signal });
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
