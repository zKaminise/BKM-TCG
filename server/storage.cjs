const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { detectImageFormat } = require('./image-format.cjs');

const formats = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
function storageError(message) { return Object.assign(new Error(message), { status: 503, code: 'STORAGE_UNAVAILABLE' }); }
function createStorage({ root = path.resolve(__dirname, '..'), env = process.env, fetchImpl = fetch } = {}) {
  const configured = Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
  const bucket = env.SUPABASE_STORAGE_BUCKET || 'bkm-public';
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(bucket)) throw storageError('Nome do bucket inválido.');
  let base;
  if (configured) {
    base = new URL(env.SUPABASE_URL);
    if (base.protocol !== 'https:' || !base.hostname.endsWith('.supabase.co') || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw storageError('Configure a URL HTTPS do projeto Supabase.');
  }
  const headers = () => ({ apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` });
  async function upload({ buffer, mime }) {
    if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > 8 * 1024 * 1024 || !formats[mime]) throw Object.assign(new Error('Envie uma imagem PNG, JPEG ou WebP de até 8 MB.'), { status: 422, code: 'VALIDATION' });
    const format=detectImageFormat(buffer);
    if(!format)throw Object.assign(new Error('O arquivo não contém uma imagem PNG, JPEG ou WebP válida.'),{status:422,code:'INVALID_IMAGE'});
    mime=format.mime;
    const filename = `${crypto.randomUUID()}.${format.extension}`;
    if (!configured) {
      if (env.VERCEL || env.BKM_ENVIRONMENT === 'production') throw storageError('Armazenamento persistente ainda não configurado.');
      const folder = path.join(root, 'uploads');
      await fs.mkdir(folder, { recursive: true });
      await fs.writeFile(path.join(folder, filename), buffer, { flag: 'wx' });
      return { url: `/uploads/${filename}`, kind: 'actual' };
    }
    let response;
    try {
      response = await fetchImpl(new URL(`/storage/v1/object/${bucket}/${filename}`, base), { method: 'POST', headers: { ...headers(), 'Content-Type': mime, 'Cache-Control': '31536000', 'x-upsert': 'false' }, body: buffer, signal: AbortSignal.timeout(12000) });
    } catch { throw storageError('Não foi possível enviar a imagem. Tente novamente.'); }
    if (!response.ok) throw storageError('O armazenamento recusou o envio. Confira o bucket e as permissões no servidor.');
    return { url: new URL(`/storage/v1/object/public/${bucket}/${filename}`, base).href, kind: 'actual' };
  }
  async function ensureBucket() {
    if (!configured) throw storageError('Configure Supabase antes de criar o bucket.');
    const check = await fetchImpl(new URL(`/storage/v1/bucket/${bucket}`, base), { headers: headers(), signal: AbortSignal.timeout(12000) });
    if (check.ok) {
      const existing = await check.json();
      if (!existing.public) throw storageError('O bucket existente é privado. Use um bucket dedicado às imagens públicas da loja.');
      return { bucket, created: false };
    }
    if (check.status !== 404 && check.status !== 400) throw storageError('Não foi possível conferir o bucket Supabase.');
    const result = await fetchImpl(new URL('/storage/v1/bucket', base), { method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify({ id: bucket, name: bucket, public: true, file_size_limit: 8388608, allowed_mime_types: Object.keys(formats) }), signal: AbortSignal.timeout(12000) });
    if (!result.ok) throw storageError('Não foi possível criar o bucket público dedicado.');
    return { bucket, created: true };
  }
  return { upload, ensureBucket, configured, provider: configured ? 'supabase' : 'local' };
}
module.exports = { createStorage };
