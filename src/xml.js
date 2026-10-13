// Tiny JSON -> XML serializer used for content negotiation (Accept: application/xml).
const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const safeName = (k) => {
  const n = String(k).replace(/[^A-Za-z0-9_.-]/g, '_');
  return /^[A-Za-z_]/.test(n) ? n : '_' + n;
};

function node(name, v) {
  if (v === null || v === undefined) return `<${name}/>`;
  if (Array.isArray(v)) return `<${name}>${v.map((i) => node('item', i)).join('')}</${name}>`;
  if (typeof v === 'object') {
    return `<${name}>${Object.entries(v).map(([k, x]) => node(safeName(k), x)).join('')}</${name}>`;
  }
  return `<${name}>${esc(v)}</${name}>`;
}

function toXml(body, root = 'response') {
  return '<?xml version="1.0" encoding="UTF-8"?>' + node(root, body);
}

module.exports = { toXml };
