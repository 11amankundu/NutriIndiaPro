// Outbound-call resilience: timeout + retry with exponential backoff + circuit breaker.
const { AppError } = require('./errors');
const logger = require('./logger');

class UpstreamError extends Error {
  constructor(message, { status, retryable = true, timeout = false } = {}) {
    super(message);
    this.name = 'UpstreamError';
    this.status = status;
    this.retryable = retryable;
    this.timeout = timeout;
  }
}

// (17) Timeout on every outbound HTTP request: AbortSignal.timeout also covers reading the body.
async function fetchJson(url, { timeoutMs, headers = {}, method = 'GET', body } = {}) {
  try {
    const res = await fetch(url, {
      method,
      headers: { Accept: 'application/json', ...headers },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      throw new UpstreamError(`Upstream responded with HTTP ${res.status}`, { status: res.status, retryable: res.status >= 500 || res.status === 429 });
    }
    return await res.json();
  } catch (e) {
    if (e instanceof UpstreamError) throw e;
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      throw new UpstreamError(`Upstream timed out after ${timeoutMs} ms`, { timeout: true });
    }
    throw new UpstreamError(`Upstream unreachable: ${(e.cause && e.cause.code) || e.message}`);
  }
}

// Generic timeout guard for libraries without a built-in one (used around the SOAP client).
function withTimeout(promise, ms, label = 'operation') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new UpstreamError(`${label} timed out after ${ms} ms`, { timeout: true })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// (18) Retry with exponential backoff: delay = base * 2^attempt (capped), with optional jitter.
async function retry(fn, opts = {}) {
  const {
    retries = 2, baseDelayMs = 100, maxDelayMs = 2000, jitter = true,
    sleep = defaultSleep, shouldRetry = (e) => e.retryable !== false, onRetry,
  } = opts;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (e) {
      if (attempt >= retries || !shouldRetry(e)) throw e;
      const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      const delay = jitter ? Math.round(exp / 2 + (Math.random() * exp) / 2) : exp;
      logger.warn('outbound_retry', { attempt: attempt + 1, delayMs: delay, reason: e.message });
      if (onRetry) onRetry({ attempt: attempt + 1, delay, error: e });
      await sleep(delay);
    }
  }
}

// (19) Circuit breaker: CLOSED -> (N failures) -> OPEN (fail fast) -> (after reset timeout) -> HALF_OPEN (one trial) -> CLOSED/OPEN.
class CircuitBreaker {
  constructor({ name = 'upstream', failureThreshold = 3, resetTimeoutMs = 10000, now = Date.now } = {}) {
    Object.assign(this, { name, failureThreshold, resetTimeoutMs, now });
    this.state = 'CLOSED';
    this.failures = 0;
    this.openedAt = null;
  }

  currentState() {
    if (this.state === 'OPEN' && this.now() - this.openedAt >= this.resetTimeoutMs) this.state = 'HALF_OPEN';
    return this.state;
  }

  snapshot() {
    return {
      name: this.name, state: this.currentState(), failures: this.failures,
      failureThreshold: this.failureThreshold, resetTimeoutMs: this.resetTimeoutMs,
      openedAt: this.openedAt ? new Date(this.openedAt).toISOString() : null,
    };
  }

  async exec(fn) {
    if (this.currentState() === 'OPEN') {
      const retryAfter = Math.max(1, Math.ceil((this.resetTimeoutMs - (this.now() - this.openedAt)) / 1000));
      throw new AppError(503, 'CIRCUIT_OPEN', `Circuit '${this.name}' is open - failing fast without calling the upstream`, { retryAfterSeconds: retryAfter });
    }
    try {
      const result = await fn();
      this.failures = 0;
      this.state = 'CLOSED';
      return result;
    } catch (e) {
      if (e.retryable === false) throw e; // client-side problems (e.g. 404) do not trip the breaker
      this.failures += 1;
      if (this.state === 'HALF_OPEN' || this.failures >= this.failureThreshold) {
        this.state = 'OPEN';
        this.openedAt = this.now();
        logger.warn('circuit_opened', { breaker: this.name, failures: this.failures });
      }
      throw e;
    }
  }
}

// Map low-level failures to API errors (504 timeout / 502 bad gateway); AppError (e.g. 503 open circuit) passes through.
function toApiError(e, extra = {}) {
  if (e instanceof AppError) return e;
  if (e.timeout) return new AppError(504, 'UPSTREAM_TIMEOUT', e.message, extra);
  return new AppError(502, 'UPSTREAM_ERROR', e.message, extra);
}

module.exports = { UpstreamError, fetchJson, withTimeout, retry, CircuitBreaker, toApiError };
