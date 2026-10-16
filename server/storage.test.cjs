const test = require('node:test');
const assert = require('node:assert/strict');
const { createStorage } = require('./storage.cjs');
const env = { SUPABASE_URL: 'https://bkm-example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-only-server-key', SUPABASE_STORAGE_BUCKET: 'bkm-public' };
test('storage never silently writes into ephemeral hosting filesystem', async () => {
  await assert.rejects(createStorage({ env: { VERCEL: '1' } }).upload({ buffer: Buffer.from('x'), mime: 'image/png' }), { code: 'STORAGE_UNAVAILABLE' });
});
test('storage uploads to dedicated public bucket without exposing server credentials', async () => {
  let request;
  const storage = createStorage({ env, fetchImpl: async (url, options) => { request = { url: String(url), options }; return { ok: true }; } });
  const result = await storage.upload({ buffer: Buffer.from('png-test'), mime: 'image/png' });
  assert.match(result.url, /^https:\/\/bkm-example\.supabase\.co\/storage\/v1\/object\/public\/bkm-public\/[a-f0-9-]+\.png$/);
  assert.equal(request.options.headers['x-upsert'], 'false');
  assert.equal(result.kind, 'actual');
  assert.ok(!JSON.stringify(result).includes(env.SUPABASE_SERVICE_ROLE_KEY));
});
test('storage restricts types size and service host; errors do not expose upstream response', async () => {
  assert.throws(() => createStorage({ env: { ...env, SUPABASE_URL: 'http://127.0.0.1:8000' } }));
  const storage = createStorage({ env, fetchImpl: async () => ({ ok: false, status: 500, text: async () => env.SUPABASE_SERVICE_ROLE_KEY }) });
  await assert.rejects(storage.upload({ buffer: Buffer.alloc(8 * 1024 * 1024 + 1), mime: 'image/png' }), { code: 'VALIDATION' });
  await assert.rejects(storage.upload({ buffer: Buffer.from('svg'), mime: 'image/svg+xml' }), { code: 'VALIDATION' });
  await assert.rejects(storage.upload({ buffer: Buffer.from('png'), mime: 'image/png' }), error => error.code === 'STORAGE_UNAVAILABLE' && !error.message.includes(env.SUPABASE_SERVICE_ROLE_KEY));
});
