'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {passwordValidation}=require('../server/password-policy.cjs');
const { parseArguments, validateSandboxEnv, assertTestSeller, assertRemoteConfig, verifyEnvironment, waitForApprovalAndWebhook, createState, validateState, fixtureProduct, checkoutPayload, assertDedicatedData, publicOrder } = require('../scripts/homologate-mp.cjs');
const project = 'abcdefghijklmnopqrst', seller = '123456789';
function envFixture() { return { SUPABASE_URL: `https://${project}.supabase.co`, DATABASE_URL: `postgresql://postgres.${project}:fictitious-password@aws-1-sa-east-1.pooler.supabase.com:6543/postgres`, BKM_ENVIRONMENT: 'staging', HOSTING_DEMO_ONLY: 'false', BKM_PUBLIC_URL: 'https://bkm-tcg-sandbox.vercel.app', PAYMENT_PROVIDER: 'mercadopago', MERCADO_PAGO_ENABLED: 'true', MERCADO_PAGO_ENVIRONMENT: 'sandbox', MERCADO_PAGO_PRODUCTION_APPROVED: 'false', MERCADO_PAGO_ACCESS_TOKEN: 'APP_USR-fictitious-not-usable', MERCADO_PAGO_PUBLIC_KEY: 'APP_USR-public-fictitious', MERCADO_PAGO_WEBHOOK_SECRET: 'fictitious-signing-key', MERCADO_PAGO_SELLER_ID: seller, EMAIL_PROVIDER: 'development', BKM_SANDBOX_BUYER_EMAIL: 'buyer-fixture@testuser.com', BKM_SANDBOX_CONFIRMATION: `SANDBOX_ONLY:${project}:${seller}` }; }
const options = { project, seller, mode: 'run' };
const config = { project, seller, baseUrl: 'https://bkm-tcg-sandbox.vercel.app' };
const remoteConfig = env => ({ environment: 'staging', demo: false, payments: { provider: 'mercadopago', environment: 'sandbox', available: true, canCharge: false, publicKey: env.MERCADO_PAGO_PUBLIC_KEY } });
const refuses = (fn, code) => assert.throws(fn, error => error.code === code);

test('Homologação MP CLI exige ambiente dedicado, confirmação e TLS sem fallback principal', () => {
  assert.equal(parseArguments([]).mode, 'verify');
  assert.deepEqual(parseArguments(['--run', '--project', project, '--seller', seller]), options);
  refuses(() => parseArguments(['--run', '--verify']), 'ARGUMENTS_INVALID');
  refuses(() => parseArguments(['--env', '.env']), 'ARGUMENTS_INVALID');
  const env = envFixture(); assert.deepEqual(validateSandboxEnv(env, options), config);
  const cases = [
    ['BKM_ENVIRONMENT', 'production', 'STAGING_REQUIRED'], ['HOSTING_DEMO_ONLY', 'true', 'STAGING_REQUIRED'],
    ['BKM_PUBLIC_URL', 'https://lojabkm.com.br', 'SANDBOX_URL_REQUIRED'], ['PUBLIC_URL', 'https://evil.example', 'SANDBOX_URL_REQUIRED'],
    ['MERCADO_PAGO_ENVIRONMENT', 'production', 'SANDBOX_PAYMENT_REQUIRED'], ['MERCADO_PAGO_PRODUCTION_APPROVED', 'true', 'SANDBOX_PAYMENT_REQUIRED'],
    ['MERCADO_PAGO_ENABLED', 'false', 'SANDBOX_PAYMENT_REQUIRED'], ['DATABASE_SSL_VERIFY', 'false', 'DATABASE_TLS_REQUIRED'],
    ['DATABASE_SSL', 'disable', 'DATABASE_TLS_REQUIRED'], ['EMAIL_PROVIDER', 'resend', 'EXTERNAL_EMAIL_MUST_BE_DISABLED'],
    ['RESEND_ENABLED', 'true', 'EXTERNAL_EMAIL_MUST_BE_DISABLED'], ['BKM_SANDBOX_CONFIRMATION', '', 'EXPLICIT_SANDBOX_CONFIRMATION_REQUIRED'],
    ['BKM_SANDBOX_BUYER_EMAIL', 'real@example.com', 'TEST_BUYER_REQUIRED'], ['DATABASE_URL', env.DATABASE_URL + '?sslmode=no-verify', 'DATABASE_POOLER_INVALID'],
    ['DATABASE_URL', env.DATABASE_URL.replace(':6543/', ':5432/'), 'DATABASE_POOLER_INVALID'], ['DATABASE_URL', env.DATABASE_URL.replace('pooler.supabase.com', 'pooler.supabase.com.evil.example'), 'DATABASE_POOLER_INVALID']
  ];
  for (const [key, value, code] of cases) refuses(() => validateSandboxEnv({ ...env, [key]: value }, options), code);
  for (const mainProject of ['nxrvmanifngjmdtgnzoq', 'cxoeompxmgdzufgzxerw']) {
    const mainEnv = { ...env, SUPABASE_URL: `https://${mainProject}.supabase.co`, DATABASE_URL: env.DATABASE_URL.replace(`postgres.${project}:`, `postgres.${mainProject}:`), BKM_SANDBOX_CONFIRMATION: `SANDBOX_ONLY:${mainProject}:${seller}` };
    for (const mode of ['verify', 'run']) refuses(() => validateSandboxEnv(mainEnv, { ...options, project: mainProject, mode }), 'DEDICATED_PROJECT_REQUIRED');
  }
  refuses(() => validateSandboxEnv(env, { ...options, seller: '999' }), 'SELLER_CONFIRMATION_REQUIRED');
  refuses(() => validateSandboxEnv({ ...env, SUPABASE_URL: 'https://nxrvmanifngjmdtgnzoq.supabase.co' }, options), 'DATABASE_PROJECT_MISMATCH');
});

test('Homologação MP CLI não infere sandbox por prefixo APP_USR, apelido ou rótulo Checkout Pro', () => {
  const proof = assertTestSeller({ id: Number(seller), site_id: 'MLB', tags: ['test_user'] }, seller);
  assert.equal(proof.testUser, true);
  assert.equal(assertTestSeller({ id: seller, site_id: 'MLB', test_user: true }, seller).sellerId, seller);
  for (const data of [{ id: seller, site_id: 'MLB', nickname: 'TEST_USER', tags: [] }, { id: '999', site_id: 'MLB', tags: ['test_user'] }, { id: seller, site_id: 'MLA', test_user: true }, { id: seller, site_id: 'MLB', test_user: 'true' }]) refuses(() => assertTestSeller(data, seller), 'SELLER_IS_NOT_CONFIRMED_TEST_USER');
  const env = envFixture(), remote = remoteConfig(env); assert.equal(assertRemoteConfig(remote, env).chargesEnabled, false);
  for (const patch of [{ environment: 'demo' }, { demoDataVersion: 1 }, { payments: { ...remote.payments, publicKey: 'other-key' } }, { payments: { ...remote.payments, canCharge: true } }]) refuses(() => assertRemoteConfig({ ...remote, ...patch }, env), 'REMOTE_SANDBOX_NOT_READY');
});

test('Homologação MP CLI verify realiza somente GETs e recusa configuração antes de qualquer rede', async () => {
  const env = envFixture(), calls = [];
  const transport = async (url, input) => { calls.push({ url, method: input.method || 'GET' }); assert.equal(input.redirect, 'error'); return new Response(JSON.stringify(url.endsWith('/users/me') ? { id: seller, site_id: 'MLB', tags: ['test_user'], email: 'private-must-not-be-in-result@testuser.com' } : remoteConfig(env)), { status: 200 }); };
  const proof = await verifyEnvironment(env, { ...options, mode: 'verify' }, transport);
  assert.deepEqual(calls, [{ url: 'https://api.mercadopago.com/users/me', method: 'GET' }, { url: 'https://bkm-tcg-sandbox.vercel.app/api/config', method: 'GET' }]);
  assert.equal(proof.readOnly, true); assert.equal(JSON.stringify(proof).includes('private-must-not'), false); assert.equal(JSON.stringify(proof).includes(env.MERCADO_PAGO_ACCESS_TOKEN), false);
  calls.length = 0;
  await assert.rejects(verifyEnvironment({ ...env, HOSTING_DEMO_ONLY: 'true' }, options, transport), error => error.code === 'STAGING_REQUIRED'); assert.equal(calls.length, 0);
  for (const mainProject of ['nxrvmanifngjmdtgnzoq', 'cxoeompxmgdzufgzxerw']) {
    const mainEnv = { ...env, SUPABASE_URL: `https://${mainProject}.supabase.co`, DATABASE_URL: env.DATABASE_URL.replace(`postgres.${project}:`, `postgres.${mainProject}:`), BKM_SANDBOX_CONFIRMATION: `SANDBOX_ONLY:${mainProject}:${seller}` };
    await assert.rejects(verifyEnvironment(mainEnv, { ...options, project: mainProject }, transport), error => error.code === 'DEDICATED_PROJECT_REQUIRED'); assert.equal(calls.length, 0);
  }
  await assert.rejects(verifyEnvironment(env, options, async () => new Response(JSON.stringify({ id: seller, site_id: 'MLB', tags: [] }), { status: 200 })), error => error.code === 'SELLER_IS_NOT_CONFIRMED_TEST_USER');
});

test('Homologação MP CLI checkpoint fixa identidade e duas chaves idempotentes sem cartão ou CPF', () => {
  const env = envFixture(), state = createState(config, env.BKM_SANDBOX_BUYER_EMAIL); state.variantId = 'fixture-variant';
  assert.equal(validateState(state, config, env.BKM_SANDBOX_BUYER_EMAIL), state);
  assert.notEqual(state.admin.password, state.buyer.password); assert.notEqual(state.cases.pixApro.idempotencyKey, state.cases.pixPending.idempotencyKey);
  for(const account of [state.admin,state.buyer]){assert.equal(passwordValidation(account.password).valid,true);assert.equal(account.password.length,14);}
  const legacy={...state,admin:{...state.admin,password:'a'.repeat(43)},buyer:{...state.buyer,password:'b'.repeat(43)}};
  assert.equal(validateState(legacy,config,env.BKM_SANDBOX_BUYER_EMAIL),legacy,'checkpoints legados preservam acesso às contas existentes');
  refuses(()=>validateState({...state,buyer:{...state.buyer,password:'bad'}},config,env.BKM_SANDBOX_BUYER_EMAIL),'PRIVATE_CHECKPOINT_INVALID');
  refuses(() => validateState(state, { ...config, project: 'zyxwvutsrqponmlkjihg' }, env.BKM_SANDBOX_BUYER_EMAIL), 'PRIVATE_CHECKPOINT_MISMATCH');
  refuses(() => validateState({ ...state, cases: { pixApro: state.cases.pixApro } }, config, env.BKM_SANDBOX_BUYER_EMAIL), 'PRIVATE_CHECKPOINT_INVALID');
  const first = checkoutPayload(state, 'pixApro'), retry = checkoutPayload(state, 'pixApro'); assert.deepEqual(first, retry); assert.equal(first.payment.payer.firstName, 'APRO');
  const pending = checkoutPayload(state, 'pixPending'); assert.equal(pending.payment.payer.firstName, undefined); assert.equal(pending.payment.method, 'pix');
  assert.equal('card' in first.payment, false); assert.equal('identification' in first.payment.payer, false);
  const fixture = fixtureProduct(); assert.equal(fixture.variants[0].stock, 2); assert.equal(fixture.variants[0].priceCents, 5000); assert.equal(fixture.card.providerId, 'sv09-003'); assert.match(fixture.name, /HOMOLOGAÇÃO/);
});

test('Homologação MP CLI banco recusa dados alheios e DTO de evidência elimina PII, QR e token', async () => {
  const state = createState(config, 'fixture@testuser.com');
  const rows = { users: [], products: [], orders: [], settings: { value_json: '{}' } };
  const db = { prepare(sql) { const key = /FROM (\w+)/.exec(sql)[1]; return { async all() { return rows[key]; }, async get() { return rows[key]; } }; } };
  await assertDedicatedData(db, state);
  rows.users = [{ id: 'foreign', email: 'someone@example.test', role: 'ADMIN' }]; await assert.rejects(assertDedicatedData(db, state), error => error.code === 'NON_FIXTURE_USERS_REFUSED'); rows.users = [];
  rows.products = [{ id: 'foreign', sku: 'normal-store', kind: 'SINGLE' }]; await assert.rejects(assertDedicatedData(db, state), error => error.code === 'NON_FIXTURE_PRODUCTS_REFUSED'); rows.products = [];
  rows.orders = [{ id: 'foreign', user_id: 'foreign', idempotency_key: 'foreign', total_cents: 5000 }]; await assert.rejects(assertDedicatedData(db, state), error => error.code === 'NON_FIXTURE_ORDERS_REFUSED'); rows.orders = [];
  rows.settings = { value_json: '{"demoDataVersion":1}' }; await assert.rejects(assertDedicatedData(db, state), error => error.code === 'DEMO_DATABASE_REFUSED');
  const input = { id: cryptoRandomId(), status: 'CONFIRMED', paymentStatus: 'APPROVED', totalCents: 5000, contact: { email: 'secret@example.test' }, address: { street: 'private' }, payment: { providerId: 'ORD1234567890', sandbox: true, token: 'secret', pix: { copyPaste: 'sensitive-qr' } } };
  const dto = publicOrder(input); assert.deepEqual(Object.keys(dto), ['orderId', 'providerId', 'orderStatus', 'paymentStatus', 'totalCents', 'sandbox']);
  for (const forbidden of ['secret', 'private', 'sensitive-qr', 'contact', 'address', 'token']) assert.equal(JSON.stringify(dto).includes(forbidden), false);
  refuses(() => publicOrder({ ...input, totalCents: { email: 'leak' } }), 'ORDER_RESPONSE_INVALID');
});
function cryptoRandomId() { return require('node:crypto').randomUUID(); }

test('Homologação MP polling aguarda callback quando GET já aprova e aprovação quando callback chega primeiro', async () => {
  let reads = 0, callbacks = 0;
  const approvedFirst = await waitForApprovalAndWebhook({ timeoutMs: 1000, intervalMs: 1,
    readOrder: async () => { reads++; return { paymentStatus: 'APPROVED' }; },
    readWebhook: async () => ++callbacks >= 3 });
  assert.deepEqual(approvedFirst, { approved: true, webhookReceived: true, timedOut: false });
  assert.equal(reads, 3, 'aprovação imediata não deve encerrar antes do terceiro callback consultado');
  reads = 0; callbacks = 0;
  const callbackFirst = await waitForApprovalAndWebhook({ timeoutMs: 1000, intervalMs: 1,
    readOrder: async () => ({ paymentStatus: ++reads >= 3 ? 'APPROVED' : 'PENDING' }),
    readWebhook: async () => { callbacks++; return true; } });
  assert.deepEqual(callbackFirst, { approved: true, webhookReceived: true, timedOut: false });
  assert.equal(callbacks, 3, 'callback inicial não deve ser confundido com aprovação financeira');
});

test('Homologação MP polling encerra prazo mesmo com leitura pendurada e não inventa recibo', async () => {
  let signal, calls = 0;
  const timedOut = await waitForApprovalAndWebhook({ timeoutMs: 20, intervalMs: 1,
    readOrder: async () => { calls++; return { paymentStatus: 'APPROVED' }; },
    readWebhook: async () => false });
  assert.deepEqual(timedOut, { approved: true, webhookReceived: false, timedOut: true });
  assert.ok(calls >= 1);
  const hanging = await waitForApprovalAndWebhook({ timeoutMs: 20, intervalMs: 1,
    readOrder: received => { signal = received; return new Promise(() => {}); },
    readWebhook: async () => true });
  assert.deepEqual(hanging, { approved: false, webhookReceived: false, timedOut: true });
  assert.equal(signal.aborted, true, 'o prazo também interrompe o GET HTTP em andamento');
  await assert.rejects(waitForApprovalAndWebhook({ timeoutMs: 60001, readOrder: async () => ({}), readWebhook: async () => true }), error => error.code === 'POLL_ARGUMENTS_INVALID');
});
