// Outbound-call demonstrations: every call has a timeout, retry with backoff, and a circuit breaker.
const express = require('express');
const { wrap, AppError } = require('../errors');
const { validateQuery } = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { fetchJson, retry, toApiError } = require('../resilience');
const { callGetFoodNutrition } = require('../soap');

const NO_STORE = { cacheControl: 'no-store' };

module.exports = ({ cfg, upstreamBreaker, soapBreaker }) => {
  const r = express.Router();
  r.use('/external', authenticate(cfg));
  const selfBase = (req) => `${req.protocol}://${req.get('host')}`;
  const retryOpts = (onRetry) => ({ retries: cfg.retryAttempts, baseDelayMs: cfg.retryBaseDelayMs, onRetry });

  // REST upstream (the built-in mock at /mock/upstream). mode=ok|fail|slow|flaky
  r.get('/external/food-facts', validateQuery('foodFacts'), wrap(async (req, res) => {
    const { name, mode, scenario } = req.q;
    const base = cfg.upstreamBaseUrl || selfBase(req);
    const params = new URLSearchParams({ name, mode, scenario: scenario || req.correlationId, delayMs: String(cfg.outboundTimeoutMs * 3) });
    const url = `${base}/mock/upstream/food-facts?${params}`;
    let attempts = 0;
    try {
      const data = await upstreamBreaker.exec(() => retry(() => {
        attempts += 1;
        return fetchJson(url, { timeoutMs: cfg.outboundTimeoutMs, headers: { 'X-Correlation-ID': req.correlationId } });
      }, retryOpts()));
      res.respond(200, { data, meta: { attempts, breaker: upstreamBreaker.snapshot() } }, NO_STORE);
    } catch (e) {
      throw toApiError(e, { attempts, breaker: upstreamBreaker.snapshot() });
    }
  }));

  // SOAP: read WSDL, execute GetFoodNutrition
  r.get('/external/soap/food-nutrition', validateQuery('soapFood'), wrap(async (req, res) => {
    let attempts = 0;
    try {
      const out = await soapBreaker.exec(() => retry(() => {
        attempts += 1;
        return callGetFoodNutrition({ baseUrl: cfg.soapBaseUrl || selfBase(req), foodName: req.q.name, timeoutMs: cfg.outboundTimeoutMs });
      }, retryOpts()));
      res.respond(200, {
        wsdl: { url: out.wsdlUrl, operations: out.operations },
        request: { operation: 'GetFoodNutrition', foodName: req.q.name },
        response: out.result,
        raw: { requestXml: out.requestXml, responseXml: out.responseXml },
        meta: { attempts },
      }, NO_STORE);
    } catch (e) {
      if (e.soapFault) throw new AppError(404, 'SOAP_FAULT', e.message);
      throw toApiError(e, { attempts });
    }
  }));

  r.get('/external/breaker', (req, res) => {
    res.respond(200, { upstream: upstreamBreaker.snapshot(), soap: soapBreaker.snapshot() }, NO_STORE);
  });
  return r;
};
