import apiModule from '../server/api.cjs';
import workerAuthModule from '../server/worker-auth.cjs';
import commerceJobModule from '../server/commerce-job.cjs';
const { createApi } = apiModule;
const { EMAIL_JOB_PATH, workerAuthorized } = workerAuthModule;
const { COMMERCE_JOB_PATH } = commerceJobModule;
let api;
// Resend signs the original payload bytes; keep Vercel from parsing JSON first.
export const config = { api: { bodyParser: false } };
export default async function handler(req, res) {
  const pathname = new URL(req.url, 'https://localhost').pathname;
  // Reject unauthenticated scheduler probes before opening any database pool.
  const jobPath=pathname===EMAIL_JOB_PATH||pathname===COMMERCE_JOB_PATH;
  if (jobPath && !workerAuthorized(req.headers, process.env,{path:pathname,method:req.method})) {
    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({error:{code:'JOB_UNAUTHORIZED',message:'Acesso não autorizado.'}}));
  }
  if(jobPath && req.method!=='GET'){
    res.writeHead(405,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Allow':'GET'});
    return res.end(JSON.stringify({error:{code:'METHOD_NOT_ALLOWED',message:'Método não permitido.'}}));
  }
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
  return api.handle(req, res, pathname);
}
