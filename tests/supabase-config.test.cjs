const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { parseArguments, validateConnection, buildSettings, updateDotEnv, atomicUpdateEnv } = require('../scripts/configure-supabase.cjs');
const connection = { host: 'aws-1-sa-east-1.pooler.supabase.com', project: 'abcdefghijklmnopqrst' };

test('configurador aceita apenas host pooler, referencia e porta previstos', () => {
  assert.deepEqual(parseArguments(['--host', connection.host, '--project', connection.project]), connection);
  assert.deepEqual(validateConnection(connection), connection);
  for (const host of ['https://' + connection.host, connection.host + ':6543', 'pooler.supabase.com', 'evil.pooler.supabase.com.evil.test', 'user@' + connection.host, 'UPPER.pooler.supabase.com', '-invalid.pooler.supabase.com']) assert.throws(() => validateConnection({ ...connection, host }));
  for (const project of ['short', 'ABCDEFGHIJKLMNOPQRST', 'abcdefghijklmnopqrs1', 'abcdefghijklmnopqrst/']) assert.throws(() => validateConnection({ ...connection, project }));
  assert.throws(() => parseArguments(['--password', 'never-a-real-password']));
  assert.throws(() => parseArguments(['--host', connection.host, '--host', connection.host]));
});

test('senha ficticia com caracteres reservados e unicode vira URI correta sem query SSL', () => {
  const password = 'ficticia @:/?#%$!\'()* é🔒';
  const values = buildSettings({ ...connection, password });
  const uri = new URL(values.DATABASE_URL);
  assert.equal(decodeURIComponent(uri.password), password);
  assert.equal(uri.username, 'postgres.' + connection.project);
  assert.equal(uri.hostname, connection.host);
  assert.equal(uri.port, '6543');
  assert.equal(uri.pathname, '/postgres');
  assert.equal(uri.search, '');
  assert.equal(values.SUPABASE_URL, `https://${connection.project}.supabase.co`);
  assert.equal(values.SUPABASE_STORAGE_BUCKET, 'bkm-public');
  assert.equal(values.BKM_DB_POOL_SIZE, '1');
  assert.ok(!values.DATABASE_URL.includes('!'));
  assert.throws(() => buildSettings({ ...connection, password: 'line\nbreak' }));
});

test('dotenv preserva outras chaves, comentarios, CRLF, BOM e valores multilinha', () => {
  const values = buildSettings({ ...connection, password: 'ficticia-exclusiva-teste' });
  const untouched = '# comentario original\r\nBKM_PUBLIC_URL=http://localhost:4173\r\nDATABASE_CA_CERT="primeira linha\r\nDATABASE_URL=texto dentro do certificado\r\nultima linha"\r\nSUPABASE_SERVICE_ROLE_KEY=chave-ficticia-preservada\r\n';
  const source = '\ufeff' + untouched + 'export DATABASE_URL = "valor-antigo" # comentario da chave\r\nDATABASE_URL=duplicado\r\nOTHER=value';
  const updated = updateDotEnv(source, values);
  assert.ok(updated.startsWith('\ufeff' + untouched));
  assert.ok(updated.includes('OTHER=value\r\n'));
  assert.equal(updated.split('DATABASE_URL=' + values.DATABASE_URL).length - 1, 1);
  assert.ok(!updated.includes('valor-antigo'));
  assert.ok(!updated.includes('duplicado'));
  assert.equal(updateDotEnv(updated, values), updated);
  assert.throws(() => updateDotEnv('OTHER="sem fechamento\nDATABASE_URL=x', values));
  assert.throws(() => updateDotEnv('', { ...values, UNRELATED: 'nao-permitido' }));
});

test('escrita atomica altera apenas fixture temporaria e nao deixa arquivo de senha', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'bkm-config-fixture-'));
  const filename = path.join(folder, '.env');
  try {
    fs.writeFileSync(filename, 'OTHER=preservado\nDATABASE_URL=antigo\n');
    const values = buildSettings({ ...connection, password: 'senha-ficticia-fixture' });
    atomicUpdateEnv(filename, values);
    assert.equal(fs.readFileSync(filename, 'utf8'), updateDotEnv('OTHER=preservado\nDATABASE_URL=antigo\n', values));
    assert.deepEqual(fs.readdirSync(folder), ['.env']);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test('CLI recusa pipe antes de ler senha ou acessar .env real', () => {
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/configure-supabase.cjs'), '--host', connection.host, '--project', connection.project], { input: 'senha-ficticia-nao-lida\n', encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /terminal interativo/);
  assert.ok(!result.stdout.includes('senha-ficticia-nao-lida'));
  assert.ok(!result.stderr.includes('senha-ficticia-nao-lida'));
});
