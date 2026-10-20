import apiModule from '../server/api.cjs';
const { createApi } = apiModule;
let api;
// Resend signs the original payload bytes; keep Vercel from parsing JSON first.
export const config = { api: { bodyParser: false } };
export default async function handler(req, res) {
  // Stop all application reads and writes before opening the database during a
  // planned migration. Some GET endpoints also create sessions or flush mail.
  if (process.env.BKM_MAINTENANCE_MODE === 'true') {
    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '60' });
    return res.end(JSON.stringify({ error: { code: 'MAINTENANCE', message: 'A loja está em manutenção por alguns instantes. Tente novamente em breve.' } }));
  }
  const publicUrl = process.env.BKM_PUBLIC_URL;
  if (!publicUrl || !process.env.DATABASE_URL) {
    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ error: { code: 'NOT_CONFIGURED', message: 'A demonstração está sendo configurada. Tente novamente em instantes.' } }));
  }
  const env = process.env.HOSTING_DEMO_ONLY !== 'false' ? { ...process.env, HOSTING_DEMO_ONLY: 'true', BKM_ENVIRONMENT: 'demo', PAYMENT_PROVIDER: 'mock' } : process.env;
  api ||= createApi({ env, secureCookies: true, allowedOrigins: [new URL(publicUrl).origin], publicUrl });
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  return api.handle(req, res, new URL(req.url, publicUrl).pathname);
}
