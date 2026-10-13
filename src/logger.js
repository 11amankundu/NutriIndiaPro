// Structured (JSON-lines) logging. The correlation ID is carried through async calls
// with AsyncLocalStorage, so every log line of a request shares the same ID.
const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
let sink = (line) => process.stdout.write(line + '\n');

function log(level, msg, fields = {}) {
  const threshold = LEVELS[process.env.LOG_LEVEL || 'info'] ?? LEVELS.info;
  if (LEVELS[level] < threshold) return;
  const store = als.getStore();
  sink(JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    correlationId: store && store.correlationId,
    ...fields,
  }));
}

module.exports = {
  als,
  debug: (m, f) => log('debug', m, f),
  info: (m, f) => log('info', m, f),
  warn: (m, f) => log('warn', m, f),
  error: (m, f) => log('error', m, f),
  setSink: (fn) => { sink = fn; },
  resetSink: () => { sink = (line) => process.stdout.write(line + '\n'); },
};
