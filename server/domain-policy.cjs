const OFFICIAL_ORIGIN = 'https://lojabkm.com.br';
const OFFICIAL_ALIASES = ['https://www.lojabkm.com.br', 'https://bkm-tcg-demo.vercel.app'];
function originOf(value) {
  try { const u = new URL(value); return !u.username && !u.password && ['http:', 'https:'].includes(u.protocol) ? u.origin : null; } catch { return null; }
}
function allowedOrigins({publicUrl, additional=[]}={}) {
  const primary = originOf(publicUrl);
  const origins = new Set(primary ? [primary] : []);
  // Explicit, owned aliases only. Preview domains are never accepted by suffix.
  if ([OFFICIAL_ORIGIN, ...OFFICIAL_ALIASES].includes(primary)) for (const item of [OFFICIAL_ORIGIN, ...OFFICIAL_ALIASES]) origins.add(item);
  for (const item of additional) if (originOf(item) === item) origins.add(item);
  return [...origins];
}
function safeReturnPath(value, fallback='/conta') {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020]/.test(value) || value.length > 1024) return fallback;
  try { const u = new URL(value, OFFICIAL_ORIGIN); return u.origin === OFFICIAL_ORIGIN && !u.pathname.startsWith('/api/') ? u.pathname + u.search : fallback; } catch { return fallback; }
}
module.exports = {OFFICIAL_ORIGIN, allowedOrigins, originOf, safeReturnPath};
