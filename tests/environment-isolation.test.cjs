const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { testEnvironment } = require('../scripts/test-env.cjs');

test('ambiente dos testes não transmite banco, storage, provedores, NODE_OPTIONS ou segredos arbitrários', () => {
  const clean = testEnvironment({ PATH: 'system-path', TEMP: 'system-temp', DATABASE_URL: 'fixture', SUPABASE_URL: 'fixture', SUPABASE_SERVICE_ROLE_KEY: 'fixture', MERCADO_PAGO_ACCESS_TOKEN: 'fixture', RESEND_API_KEY: 'fixture', UNKNOWN_FUTURE_SECRET: 'fixture', NODE_OPTIONS: '--env-file=.env', VERCEL: '1' });
  assert.equal(clean.PATH, 'system-path');
  assert.equal(clean.TEMP, 'system-temp');
  for (const key of ['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'MERCADO_PAGO_ACCESS_TOKEN', 'RESEND_API_KEY', 'UNKNOWN_FUTURE_SECRET', 'NODE_OPTIONS', 'VERCEL']) assert.equal(clean[key], undefined, key);
  assert.equal(clean.BKM_SKIP_DOTENV, 'true');
  assert.equal(clean.NODE_ENV, 'test');
});

test('dotenv é ignorado sob teste e importações não carregam o .env do projeto', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bkm-env-fixture-')), filename = path.join(dir, '.env');
  const loader = path.resolve(__dirname, '../server/env.cjs');
  fs.writeFileSync(filename, 'BKM_ENV_FIXTURE_MARKER=fixture-only\n');
  const evaluate = (code, overrides) => spawnSync(process.execPath, ['-e', code], { env: testEnvironment(process.env, overrides), encoding: 'utf8' });
  try {
    for (const guard of [{ BKM_SKIP_DOTENV: 'true', NODE_ENV: '' }, { BKM_SKIP_DOTENV: '', NODE_ENV: 'test' }, { BKM_SKIP_DOTENV: '', NODE_ENV: '', NODE_TEST_CONTEXT: 'child-v8' }]) {
      const result = evaluate(`const assert=require('node:assert/strict'); assert.equal(require(${JSON.stringify(loader)}).loadProjectEnvFile(${JSON.stringify(filename)}),false); assert.equal(process.env.BKM_ENV_FIXTURE_MARKER,undefined);`, guard);
      assert.equal(result.status, 0, result.stderr);
    }
    const ordinary = evaluate(`const assert=require('node:assert/strict'); assert.equal(require(${JSON.stringify(loader)}).loadProjectEnvFile(${JSON.stringify(filename)}),true); assert.equal(process.env.BKM_ENV_FIXTURE_MARKER,'fixture-only');`, { BKM_SKIP_DOTENV: '', NODE_ENV: '' });
    assert.equal(ordinary.status, 0, ordinary.stderr);
    const imported = evaluate(`process.loadEnvFile=()=>{throw new Error('dotenv loaded during import')}; ${['../serve.cjs', '../scripts/seed-demo.cjs', '../scripts/import-sqlite.cjs'].map(file => `require(${JSON.stringify(path.resolve(__dirname, file))});`).join('')}`, { BKM_SKIP_DOTENV: '', NODE_ENV: '' });
    assert.equal(imported.status, 0, imported.stderr);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('barreira de rede dos testes recusa API e PostgreSQL remotos antes de abrir conexão', () => {
  const guard = path.resolve(__dirname, '../scripts/test-network.cjs');
  const code = `require(${JSON.stringify(guard)}); const assert=require('node:assert/strict'); assert.throws(()=>require('node:net').connect({host:'outside.invalid',port:5432}),/TEST_NETWORK_ISOLATION/); fetch('https://outside.invalid').then(()=>process.exitCode=1,error=>assert.match(error.message,/TEST_NETWORK_ISOLATION/));`;
  const result = spawnSync(process.execPath, ['-e', code], { env: testEnvironment(), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
