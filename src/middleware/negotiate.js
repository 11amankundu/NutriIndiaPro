// Adds res.respond(status, body, opts): JSON/XML content negotiation, Cache-Control, ETag and 304 handling.
const crypto = require('crypto');
const { toXml } = require('../xml');
const { AppError } = require('../errors');

function etagMatches(header, etag) {
  if (!header) return false;
  if (header.trim() === '*') return true;
  const strip = (t) => t.trim().replace(/^W\//, '');
  return header.split(',').some((t) => strip(t) === strip(etag));
}

function negotiate() {
  return (req, res, next) => {
    const accepted = req.accepts(['application/json', 'application/xml', 'text/xml']);
    req.notAcceptable = !accepted;
    req.wantsXml = accepted === 'application/xml' || accepted === 'text/xml';

    res.respond = (status, body, opts = {}) => {
      res.status(status);
      res.vary('Accept');
      if (status === 204 || status === 304) return res.end();
      const payload = req.wantsXml ? toXml(body, opts.xmlRoot || 'response') : JSON.stringify(body);
      res.type(req.wantsXml ? 'application/xml' : 'application/json');
      if ((req.method === 'GET' || req.method === 'HEAD') && status === 200) {
        res.set('Cache-Control', opts.cacheControl || 'private, max-age=30');
        const etag = `"${crypto.createHash('sha1').update(payload).digest('base64url')}"`;
        res.set('ETag', etag);
        if (etagMatches(req.get('If-None-Match'), etag)) {
          res.removeHeader('Content-Type');
          return res.status(304).end();
        }
      } else {
        res.set('Cache-Control', 'no-store');
      }
      return res.send(payload);
    };
    next();
  };
}

// Used inside /v1: reject clients that accept neither JSON nor XML.
const requireAcceptable = (req, res, next) => (req.notAcceptable
  ? next(new AppError(406, 'NOT_ACCEPTABLE', 'Supported representations: application/json, application/xml'))
  : next());

// Used inside /v1: request bodies must be JSON.
const requireJsonBody = (req, res, next) => {
  const hasBody = Number(req.get('content-length') || 0) > 0;
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && hasBody && !req.is('application/json')) {
    return next(new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json'));
  }
  return next();
};

module.exports = { negotiate, requireAcceptable, requireJsonBody };
