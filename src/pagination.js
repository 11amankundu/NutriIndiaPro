// Cursor-based (keyset) pagination helpers. A cursor is an opaque base64url token.
const { AppError } = require('./errors');

const invalidCursor = () => new AppError(400, 'INVALID_CURSOR', 'Cursor is invalid');
const encode = (arr) => Buffer.from(JSON.stringify(arr)).toString('base64url');

function decode(token) {
  try {
    const v = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
    if (!Array.isArray(v)) throw new Error('bad');
    return v;
  } catch (_) {
    throw invalidCursor();
  }
}

// Cursor of shape [id]
function decodeIdCursor(token) {
  if (!token) return null;
  const c = decode(token);
  if (!Number.isInteger(c[0])) throw invalidCursor();
  return c[0];
}

// Cursor of shape [date, id]
function decodeDateIdCursor(token) {
  if (!token) return null;
  const c = decode(token);
  if (typeof c[0] !== 'string' || !Number.isInteger(c[1])) throw invalidCursor();
  return c;
}

// rows were fetched with LIMIT (limit + 1): the extra row tells us whether another page exists.
function buildPage(req, res, rows, limit, cursorOf) {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  let next = null;
  if (hasMore) {
    const params = new URLSearchParams(req.query);
    params.set('limit', String(limit));
    params.set('cursor', encode(cursorOf(data[data.length - 1])));
    next = `${req.baseUrl}${req.path}?${params.toString()}`;
    res.set('Link', `<${next}>; rel="next"`);
  }
  return { data, page: { limit, next } };
}

module.exports = { encode, decodeIdCursor, decodeDateIdCursor, buildPage };
