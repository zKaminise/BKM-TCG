const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { detectImageFormat } = require('./image-format.cjs');

const photoRoute = '/api/account/collection/photos';
const photoPath = /^\/api\/account\/collection\/photos\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const bucket = 'bkm-collection-private';
const maxBytes = 2 * 1024 * 1024;
const types = ['image/png', 'image/jpeg', 'image/webp'];
const storageError = (message, status = 503, code = 'STORAGE_UNAVAILABLE') =>
  Object.assign(new Error(message), { status, code });

function createCollectionPhotos({ env, folder, fetchImpl = fetch }) {
  const configured = Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);

  async function request(endpoint, options = {}) {
    try {
      const url = new URL(env.SUPABASE_URL);
      if (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co') ||
          url.port || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error();
      return await fetchImpl(new URL('/storage/v1/' + endpoint, url), {
        ...options, redirect: 'error', signal: AbortSignal.timeout(12000),
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          ...options.headers
        }
      });
    } catch {
      throw storageError('Não foi possível acessar o armazenamento de fotos. Tente novamente.');
    }
  }

  function useLocal() {
    if (env.VERCEL || env.BKM_ENVIRONMENT === 'production' || !folder)
      throw storageError('O armazenamento privado de fotos ainda não está configurado.');
  }

  // BKM authenticates its own sessions. Use a separate storage namespace for
  // each owner and never hand out the storage URL or its server credential.
  const objectKey = (userId, id) => `${createHash('sha256').update(userId).digest('hex')}/${id}`;

  async function upload(userId, { data, mime }) {
    if (!types.includes(mime) || typeof data !== 'string' || data.length > Math.ceil(maxBytes / 3) * 4 ||
        data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data))
      throw storageError('Envie uma foto PNG, JPEG ou WebP de até 2 MB.', 422, 'INVALID_IMAGE');
    const buffer = Buffer.from(data, 'base64');
    const format = detectImageFormat(buffer);
    if (!format || buffer.length > maxBytes)
      throw storageError('O arquivo não contém uma imagem PNG, JPEG ou WebP válida de até 2 MB.', 422, 'INVALID_IMAGE');
    // Retries and attaching the same photo twice reuse the same private object.
    const hash = createHash('sha256').update(buffer).digest('hex');
    const id = [hash.slice(0, 8), hash.slice(8, 12), hash.slice(12, 16), hash.slice(16, 20), hash.slice(20, 32)].join('-');
    const key = objectKey(userId, id);
    if (configured) {
      const response = await request(`object/${bucket}/${key}`, {
        method: 'POST', body: buffer,
        headers: { 'Content-Type': format.mime, 'x-upsert': 'true', 'Cache-Control': '0' }
      });
      if (!response.ok) throw storageError('O armazenamento privado recusou o envio da foto.');
    } else {
      useLocal();
      const file = path.join(folder, key);
      await fs.mkdir(path.dirname(file), { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, buffer, { flag: 'wx' });
        await fs.rename(temporary, file);
      } finally {
        await fs.rm(temporary, { force: true });
      }
    }
    return { url: `${photoRoute}/${id}` };
  }

  async function download(userId, id) {
    if (!photoPath.test(`${photoRoute}/${id}`)) return null;
    const key = objectKey(userId, id);
    if (configured) {
      const response = await request(`object/authenticated/${bucket}/${key}`);
      if (response.status === 400 || response.status === 404) return null;
      if (!response.ok) throw storageError('Não foi possível abrir esta foto.');
      const mime = response.headers.get('content-type')?.split(';')[0];
      if (!types.includes(mime) || Number(response.headers.get('content-length')) > maxBytes) return null;
      const buffer = Buffer.from(await response.arrayBuffer());
      return buffer.length <= maxBytes ? { buffer, mime } : null;
    }
    useLocal();
    let buffer;
    try { buffer = await fs.readFile(path.join(folder, key)); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    const format = detectImageFormat(buffer);
    return format ? { buffer, mime: format.mime } : null;
  }

  async function ensureBucket() {
    if (!configured) throw storageError('Configure Supabase antes de criar o bucket privado.');
    const response = await request(`bucket/${bucket}`);
    if (response.ok) {
      if ((await response.json()).public !== false) throw storageError('O bucket de fotos da coleção precisa ser privado.');
      return { bucket, created: false };
    }
    if (response.status !== 400 && response.status !== 404) throw storageError('Não foi possível conferir o bucket privado.');
    const created = await request('bucket', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: bucket, name: bucket, public: false, file_size_limit: maxBytes, allowed_mime_types: types })
    });
    if (!created.ok) throw storageError('Não foi possível criar o bucket privado de fotos.');
    return { bucket, created: true };
  }
  return { upload, download, ensureBucket };
}

module.exports = {
  createCollectionPhotos, photoRoute, photoPath,
  photoBucket: bucket, photoBackupFolder: 'collection-photos',
  photoBodyLimit: Math.ceil(maxBytes / 3) * 4 + 256
};
