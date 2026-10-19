const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { createServer } = require('../serve.cjs');
const { openDatabase } = require('../server/db.cjs');
const { hashPassword, verifyPassword } = require('../server/auth.cjs');
const { testEnvironment } = require('../scripts/test-env.cjs');

test('bootstrap de senha curta exige --demo explícito e ambiente demo, sem divulgar o segredo', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bkm-demo-admin-'));
  const filename = path.join(dir, 'demo.sqlite'), password = crypto.randomBytes(6).toString('base64url');
  const run = (environment, args = []) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve(__dirname, '../scripts/create-admin.cjs'), '--email', 'demo-admin@example.test', '--name', 'Admin de teste', ...args], {
      env: testEnvironment(process.env, { BKM_DB_PATH: filename, BKM_ENVIRONMENT: environment }), stdio: ['pipe', 'pipe', 'pipe']
    });
    let output = '';
    child.stdout.on('data', chunk => output += chunk);
    child.stderr.on('data', chunk => output += chunk);
    child.on('error', reject);
    child.on('close', code => resolve({ code, output }));
    child.stdin.end(password + '\n');
  });
  try {
    for (const [environment, args] of [['demo', []], ['production', ['--demo']], ['staging', ['--demo']]]) {
      const result = await run(environment, args);
      assert.notEqual(result.code, 0);
      assert.ok(!result.output.includes(password));
    }
    const created = await run('demo', ['--demo']);
    assert.equal(created.code, 0, created.output);
    assert.ok(!created.output.includes(password));
    const db = openDatabase(filename);
    try {
      const admin = db.prepare("SELECT * FROM users WHERE role='ADMIN'").get();
      assert.equal(admin.email, 'demo-admin@example.test');
      assert.notEqual(admin.password_hash, password);
      assert.ok(await verifyPassword(password, admin.password_hash));
    } finally { db.close(); }
    assert.notEqual((await run('demo', ['--demo'])).code, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('login de admin demo aceita senha de oito caracteres sem reduzir cadastro, cliente ou produção', async t => {
  const password = crypto.randomBytes(6).toString('base64url');
  for (const environment of ['demo', 'staging', 'production']) await t.test(environment, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bkm-demo-login-'));
    const server = createServer({ root: dir, dbPath: path.join(dir, 'test.sqlite'), databaseUrl: '', env: { BKM_ENVIRONMENT: environment, PAYMENT_PROVIDER: 'disabled', EMAIL_PROVIDER: 'development' } });
    await server.api.ready;
    const hash = await hashPassword(password);
    for (const role of ['ADMIN', 'CUSTOMER']) server.api.db.prepare('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(), role.toLowerCase() + '@example.test', 'Conta de teste', hash, role, new Date().toISOString());
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = 'http://127.0.0.1:' + server.address().port;
    const session = await fetch(base + '/api/session'), { csrfToken } = await session.json();
    const cookie = session.headers.get('set-cookie').split(';')[0];
    const post = (route, body) => fetch(base + route, { method: 'POST', headers: { cookie, 'content-type': 'application/json', 'x-csrf-token': csrfToken }, body: JSON.stringify(body) });
    try {
      const login = await post('/api/auth/login', { email: 'admin@example.test', password });
      assert.equal(login.status, environment === 'demo' ? 200 : 401);
      if (login.status === 200) assert.equal((await login.json()).user.role, 'ADMIN');
      // The successful login rotated the anonymous cookie; use a fresh anonymous session.
      const next = await fetch(base + '/api/session'), fresh = await next.json();
      const freshPost = (route, body) => fetch(base + route, { method: 'POST', headers: { cookie: next.headers.get('set-cookie').split(';')[0], 'content-type': 'application/json', 'x-csrf-token': fresh.csrfToken }, body: JSON.stringify(body) });
      assert.equal((await freshPost('/api/auth/login', { email: 'customer@example.test', password })).status, 401);
      assert.equal((await freshPost('/api/auth/register', { email: 'new@example.test', name: 'Nova conta', password, role: 'ADMIN' })).status, 422);
    } finally {
      server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
