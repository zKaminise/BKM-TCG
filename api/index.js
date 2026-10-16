import apiModule from '../server/api.cjs';
const { createApi } = apiModule;
let api;
export default async function handler(req, res) {
  const publicUrl = process.env.BKM_PUBLIC_URL;
  if (!publicUrl || !process.env.DATABASE_URL) {
    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ error: { code: 'NOT_CONFIGURED', message: 'A demonstração está sendo configurada. Tente novamente em instantes.' } }));
  }
  const env = process.env.HOSTING_DEMO_ONLY !== 'false' ? { ...process.env, HOSTING_DEMO_ONLY: 'true', BKM_ENVIRONMENT: 'demo', PAYMENT_PROVIDER: 'mock', EMAIL_PROVIDER: 'development' } : process.env;
  api ||= createApi({ env, secureCookies: true, allowedOrigins: [new URL(publicUrl).origin], publicUrl });
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  return api.handle(req, res, new URL(req.url, publicUrl).pathname);
}
