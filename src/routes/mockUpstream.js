// Built-in fake "third party" service so the resilience features can be demonstrated offline.
//   mode=ok     -> 200
//   mode=fail   -> always 500
//   mode=flaky  -> first 2 calls per scenario return 503, then 200 (shows retry + backoff)
//   mode=slow   -> responds after delayMs (shows the timeout)
const express = require('express');

module.exports = () => {
  const r = express.Router();
  const counters = new Map();
  r.get('/food-facts', (req, res) => {
    const { name = 'Roti', mode = 'ok', scenario = 'default', delayMs = '3000' } = req.query;
    if (mode === 'fail') return res.status(500).json({ error: 'simulated upstream failure' });
    if (mode === 'flaky') {
      if (counters.size > 1000) counters.clear();
      const n = (counters.get(scenario) || 0) + 1;
      counters.set(scenario, n);
      if (n <= 2) return res.status(503).json({ error: 'simulated transient failure', call: n });
    }
    const body = { name: String(name), source: 'mock-upstream', fact: `${name} is part of everyday Indian meals.` };
    if (mode === 'slow') {
      const t = setTimeout(() => res.json(body), Math.min(Number(delayMs) || 3000, 10000));
      req.on('close', () => clearTimeout(t));
      return undefined;
    }
    return res.json(body);
  });
  return r;
};
