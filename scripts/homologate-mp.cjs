'use strict';
// Deliberately independent of server/env.cjs: this command never loads .env,
// inherits deployment credentials, or falls back to the demonstration database.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {passwordValidation}=require('../server/password-policy.cjs');
const { parseEnv } = require('node:util');
const ROOT = path.resolve(__dirname, '..');
const MAIN_PROJECTS = new Set(['nxrvmanifngjmdtgnzoq', 'cxoeompxmgdzufgzxerw']);
const SANDBOX_URL = 'https://bkm-tcg-sandbox.vercel.app';
const MP_URL = 'https://api.mercadopago.com';
const SKU = 'HML-MP-BUTTERFREE';
const PRICE = 5000;
const uuid = () => crypto.randomUUID();
const fail = code => { const error = new Error(code); error.code = code; throw error; };
const assert = (value, code) => { if (!value) fail(code); };

function parseArguments(args) {
  const result = { mode: 'verify' };
  let modeSeen = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') { result.help = true; continue; }
    if (arg === '--verify' || arg === '--run') { assert(!modeSeen, 'ARGUMENTS_INVALID'); modeSeen = true; result.mode = arg.slice(2); continue; }
    assert(['--project', '--seller'].includes(arg) && result[arg.slice(2)] === undefined && args[index + 1] && !args[index + 1].startsWith('-'), 'ARGUMENTS_INVALID');
    result[arg.slice(2)] = args[++index];
  }
  return result;
}

function validateSandboxEnv(env, options) {
  const project = options.project, seller = options.seller;
  assert(/^[a-z]{20}$/.test(project || '') && !MAIN_PROJECTS.has(project), 'DEDICATED_PROJECT_REQUIRED');
  assert(/^\d{1,24}$/.test(seller || '') && seller === env.MERCADO_PAGO_SELLER_ID, 'SELLER_CONFIRMATION_REQUIRED');
  assert(env.SUPABASE_URL === `https://${project}.supabase.co`, 'DATABASE_PROJECT_MISMATCH');
  let database;
  try { database = new URL(env.DATABASE_URL); } catch { fail('DATABASE_URL_INVALID'); }
  assert(['postgres:', 'postgresql:'].includes(database.protocol) && database.username === `postgres.${project}` && !!database.password && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.pooler\.supabase\.com$/.test(database.hostname) && database.port === '6543' && database.pathname === '/postgres' && !database.search && !database.hash, 'DATABASE_POOLER_INVALID');
  assert(env.DATABASE_SSL !== 'disable' && env.DATABASE_SSL_VERIFY !== 'false', 'DATABASE_TLS_REQUIRED');
  assert(env.BKM_ENVIRONMENT === 'staging' && env.HOSTING_DEMO_ONLY === 'false', 'STAGING_REQUIRED');
  assert(env.BKM_PUBLIC_URL === SANDBOX_URL && (!env.PUBLIC_URL || env.PUBLIC_URL === SANDBOX_URL), 'SANDBOX_URL_REQUIRED');
  assert(env.PAYMENT_PROVIDER === 'mercadopago' && env.MERCADO_PAGO_ENABLED === 'true' && env.MERCADO_PAGO_ENVIRONMENT === 'sandbox' && env.MERCADO_PAGO_PRODUCTION_APPROVED === 'false', 'SANDBOX_PAYMENT_REQUIRED');
  assert(['MERCADO_PAGO_ACCESS_TOKEN', 'MERCADO_PAGO_PUBLIC_KEY', 'MERCADO_PAGO_WEBHOOK_SECRET'].every(key => typeof env[key] === 'string' && env[key].trim() && !/[\x00-\x1f\x7f]/.test(env[key])), 'TEST_CREDENTIALS_REQUIRED');
  assert(env.EMAIL_PROVIDER === 'development' && env.RESEND_ENABLED !== 'true', 'EXTERNAL_EMAIL_MUST_BE_DISABLED');
  if (options.mode === 'run') {
    assert(env.BKM_SANDBOX_CONFIRMATION === `SANDBOX_ONLY:${project}:${seller}`, 'EXPLICIT_SANDBOX_CONFIRMATION_REQUIRED');
    assert(typeof env.BKM_SANDBOX_BUYER_EMAIL === 'string' && /^[^\s@]+@testuser\.com$/i.test(env.BKM_SANDBOX_BUYER_EMAIL) && env.BKM_SANDBOX_BUYER_EMAIL.length <= 254, 'TEST_BUYER_REQUIRED');
  }
  return { project, seller, baseUrl: SANDBOX_URL };
}

function assertTestSeller(data, seller) {
  assert(data && String(data.id) === seller && data.site_id === 'MLB' && (data.test_user === true || Array.isArray(data.tags) && data.tags.includes('test_user')), 'SELLER_IS_NOT_CONFIRMED_TEST_USER');
  return { sellerId: seller, testUser: true, site: 'MLB' };
}

function assertRemoteConfig(data, env) {
  assert(data && data.environment === 'staging' && data.demo === false && !data.demoDataVersion && data.payments?.provider === 'mercadopago' && data.payments.environment === 'sandbox' && data.payments.available === true && data.payments.canCharge === false && data.payments.publicKey === env.MERCADO_PAGO_PUBLIC_KEY, 'REMOTE_SANDBOX_NOT_READY');
  return { environment: 'staging', sandbox: true, chargesEnabled: false };
}

async function jsonRequest(url, options = {}, fetchImpl = globalThis.fetch) {
  assert(url.startsWith(MP_URL + '/') || url.startsWith(SANDBOX_URL + '/'), 'REQUEST_ORIGIN_REFUSED');
  let response;
  try { response = await fetchImpl(url, { ...options, redirect: 'error', signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) }); }
  catch { fail('REMOTE_REQUEST_FAILED'); }
  assert(Number(response.headers.get('content-length') || 0) <= 1024 * 1024, 'REMOTE_RESPONSE_TOO_LARGE');
  const reader = response.body?.getReader(), chunks = []; let size = 0;
  assert(reader, 'REMOTE_RESPONSE_INVALID');
  for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > 1024 * 1024) { await reader.cancel(); fail('REMOTE_RESPONSE_TOO_LARGE'); } chunks.push(Buffer.from(next.value)); }
  let data; try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('REMOTE_RESPONSE_INVALID'); }
  return { status: response.status, ok: response.ok, headers: response.headers, data };
}

async function verifyEnvironment(env, options, fetchImpl = globalThis.fetch) {
  const config = validateSandboxEnv(env, options);
  const sellerResponse = await jsonRequest(MP_URL + '/users/me', { headers: { Accept: 'application/json', Authorization: 'Bearer ' + env.MERCADO_PAGO_ACCESS_TOKEN } }, fetchImpl);
  assert(sellerResponse.ok, 'TEST_SELLER_LOOKUP_FAILED');
  const seller = assertTestSeller(sellerResponse.data, config.seller);
  const site = await jsonRequest(SANDBOX_URL + '/api/config', {}, fetchImpl);
  assert(site.ok, 'REMOTE_SANDBOX_UNAVAILABLE');
  return { ...config, ...seller, ...assertRemoteConfig(site.data, env), readOnly: true };
}

async function waitForApprovalAndWebhook({ readOrder, readWebhook, timeoutMs = 60000, intervalMs = 2000 } = {}) {
  assert(typeof readOrder === 'function' && typeof readWebhook === 'function' && Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60000 && Number.isInteger(intervalMs) && intervalMs > 0 && intervalMs <= 60000, 'POLL_ARGUMENTS_INVALID');
  const controller = new AbortController();
  let timer, latest = { approved: false, webhookReceived: false };
  const deadline = new Promise(resolve => {
    timer = setTimeout(() => { controller.abort(); resolve({ ...latest, timedOut: true }); }, timeoutMs);
  });
  const polling = (async () => {
    while (!controller.signal.aborted) {
      const [order, received] = await Promise.all([readOrder(controller.signal), readWebhook(controller.signal)]);
      if (controller.signal.aborted) break;
      latest = { approved: order?.paymentStatus === 'APPROVED', webhookReceived: received === true };
      // The authoritative GET can approve before the asynchronous callback.
      // Never use approval alone as the condition that ends webhook polling.
      if (latest.approved && latest.webhookReceived) return { ...latest, timedOut: false };
      await new Promise(resolve => {
        const finish = () => { clearTimeout(pause); controller.signal.removeEventListener('abort', finish); resolve(); };
        const pause = setTimeout(finish, intervalMs);
        controller.signal.addEventListener('abort', finish, { once: true });
      });
    }
    return { ...latest, timedOut: true };
  })();
  try { return await Promise.race([polling, deadline]); }
  finally { clearTimeout(timer); controller.abort(); }
}

function writePrivate(filename, value) {
  const temporary = filename + '.' + uuid() + '.tmp';
  try { fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); fs.renameSync(temporary, filename); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

const newLocalPassword=()=> 'A1'+crypto.randomBytes(9).toString('base64url');
function createState(config, buyerEmail) {
  return { version: 1, project: config.project, seller: config.seller, baseUrl: config.baseUrl,
    admin: { id: uuid(), email: 'homologacao-admin@bkm.invalid', password: newLocalPassword() },
    buyer: { email: buyerEmail.toLowerCase(), password: newLocalPassword() },
    cases: { pixApro: { idempotencyKey: uuid() }, pixPending: { idempotencyKey: uuid() } } };
}
function validateState(state, config, buyerEmail) {
  assert(state?.version === 1 && state.project === config.project && state.seller === config.seller && state.baseUrl === config.baseUrl && state.buyer?.email === buyerEmail.toLowerCase(), 'PRIVATE_CHECKPOINT_MISMATCH');
  // Existing checkpoints can authenticate their legacy accounts without forcing
  // a password change. Only newly created local accounts use today's policy.
  assert(/^[a-f0-9-]{36}$/.test(state.admin?.id || '') && state.admin.email === 'homologacao-admin@bkm.invalid' && [state.admin.password, state.buyer.password].every(value => passwordValidation(value).valid || /^[\w-]{43}$/.test(value || '')), 'PRIVATE_CHECKPOINT_INVALID');
  assert(Object.keys(state.cases || {}).sort().join() === 'pixApro,pixPending' && Object.values(state.cases).every(value => /^[a-f0-9-]{36}$/.test(value.idempotencyKey || '')) && state.cases.pixApro.idempotencyKey !== state.cases.pixPending.idempotencyKey, 'PRIVATE_CHECKPOINT_INVALID');
  return state;
}

function fixtureProduct() {
  return { kind: 'SINGLE', name: 'HOMOLOGAÇÃO · Butterfree', slug: 'homologacao-mp-butterfree', sku: SKU, tcg: 'pokemon', setId: 'sv09', setName: 'Jornada Juntos', description: 'Produto fictício exclusivo para homologação financeira sandbox. Referência de carta Butterfree 003/159; sem venda ou envio real.', images: [], card: { name: 'Butterfree', number: '003', total: '159', provider: 'TCGdex', providerId: 'sv09-003', language: 'pt', hp: '130', type: 'Grass' }, variants: [{ language: 'pt', condition: 'NM', finish: 'NORMAL', priceCents: PRICE, stock: 2 }], published: true, featured: false };
}
function checkoutPayload(state, caseName) {
  return { idempotencyKey: state.cases[caseName].idempotencyKey, items: [{ variantId: state.variantId, quantity: 1 }], deliveryMode:'pickup', contact: { name: 'Comprador de homologação', email: state.buyer.email, phone: '' }, address: { name: 'Comprador de homologação', street: 'Rua de Teste', number: '1', district: 'Teste', city: 'Uberlândia', state: 'MG', zip: '38400100' }, payment: { provider: 'mercadopago', method: 'pix', payer: { email: state.buyer.email, ...(caseName === 'pixApro' ? { firstName: 'APRO' } : {}) } } };
}
function fixtureShippingSettings(){
  // Dedicated sandbox only. No carrier rate, transit promise or real dispatch.
  return {city:'Uberlândia',state:'MG',address:'',whatsapp:'5534999999999',shipping:{enabled:false,rateMode:'regional',freeShippingEnabled:false,freeShippingThresholdCents:null,regions:[],regionRates:Object.fromEntries(['N','NE','CO','SE','S'].map(id=>[id,{enabled:false}])),pickup:{enabled:true},localDelivery:{enabled:false,estimatedDays:null}}};
}
const orderKey = (userId, clientKey) => crypto.createHash('sha256').update(JSON.stringify([userId, clientKey])).digest('hex');

async function assertDedicatedData(db, state) {
  const settings = JSON.parse((await db.prepare('SELECT value_json FROM settings WHERE id=1').get()).value_json);
  assert(!settings.demoDataVersion, 'DEMO_DATABASE_REFUSED');
  const users = await db.prepare('SELECT id,email,role FROM users').all();
  assert(users.every(user => user.role === 'ADMIN' ? user.id === state.admin.id && user.email === state.admin.email : user.role === 'CUSTOMER' && user.email === state.buyer.email), 'NON_FIXTURE_USERS_REFUSED');
  assert(users.length <= 2 && users.filter(user => user.role === 'ADMIN').length <= 1, 'NON_FIXTURE_USERS_REFUSED');
  const products = await db.prepare('SELECT id,sku,kind FROM products').all();
  assert(products.length <= 1 && products.every(product => product.sku === SKU && product.kind === 'SINGLE'), 'NON_FIXTURE_PRODUCTS_REFUSED');
  const buyer = users.find(user => user.role === 'CUSTOMER');
  const allowedKeys = new Set(buyer ? Object.values(state.cases).map(value => orderKey(buyer.id, value.idempotencyKey)) : []);
  const orders = await db.prepare('SELECT id,user_id,idempotency_key,total_cents FROM orders').all();
  assert(orders.length <= 2 && orders.every(order => order.user_id === buyer?.id && allowedKeys.has(order.idempotency_key) && order.total_cents === PRICE), 'NON_FIXTURE_ORDERS_REFUSED');
  return { users, products, orders };
}

class SiteClient {
  constructor() { this.cookie = ''; this.csrf = ''; }
  async request(route, method = 'GET', body, options = {}) {
    assert(/^\/api\/[a-zA-Z0-9/_?=&.-]+$/.test(route), 'SITE_ROUTE_REFUSED');
    const result = await jsonRequest(SANDBOX_URL + route, { method, headers: { Accept: 'application/json', Origin: SANDBOX_URL, ...(this.cookie ? { Cookie: this.cookie } : {}), ...(body ? { 'Content-Type': 'application/json', 'X-CSRF-Token': this.csrf } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), ...(options.signal ? { signal: options.signal } : {}) });
    const cookie = result.headers.get('set-cookie');
    if (cookie) { const match = cookie.match(/(?:^|,\s*)(bkm_session=[A-Za-z0-9_-]{43});/); assert(match, 'SESSION_COOKIE_INVALID'); this.cookie = match[1]; }
    if (result.data.csrfToken) this.csrf = result.data.csrfToken;
    return result;
  }
  async checked(route, method, body, options) { const result = await this.request(route, method, body, options); assert(result.ok, 'SITE_API_FAILED_' + result.status); return result.data; }
  async init() { await this.checked('/api/session'); }
}

function publicOrder(order) {
  assert(order && /^[a-f0-9-]{36}$/.test(order.id || '') && /^[A-Z_]{2,30}$/.test(order.paymentStatus || '') && Number.isSafeInteger(order.totalCents) && order.totalCents === PRICE, 'ORDER_RESPONSE_INVALID');
  const providerId = order.payment?.providerId || null;
  assert(providerId === null || /^ORD[a-zA-Z0-9]{8,100}$/.test(providerId), 'ORDER_RESPONSE_INVALID');
  return { orderId: order.id, providerId, orderStatus: /^[A-Z_]{2,30}$/.test(order.status || '') ? order.status : 'UNKNOWN', paymentStatus: order.paymentStatus, totalCents: order.totalCents, sandbox: order.payment?.sandbox === true };
}

async function runHomologation(env, config, { stateFile = path.join(ROOT, '.env.sandbox.state.json'), reportFile = path.join(ROOT, 'backups', 'mp-sandbox-report.json') } = {}) {
  const state = fs.existsSync(stateFile) ? validateState(JSON.parse(fs.readFileSync(stateFile, 'utf8')), config, env.BKM_SANDBOX_BUYER_EMAIL) : createState(config, env.BKM_SANDBOX_BUYER_EMAIL);
  writePrivate(stateFile, state); // Credentials and both stable keys exist before the first remote mutation.
  const persist = () => writePrivate(stateFile, state);
  const report = { version: 1, project: config.project, sellerId: config.seller, publicUrl: SANDBOX_URL, environment: 'sandbox', testUser: true, chargesEnabled: false, startedAt: new Date().toISOString(), cases: {}, complete: false };
  const saveReport = () => { fs.mkdirSync(path.dirname(reportFile), { recursive: true }); writePrivate(reportFile, report); };
  let db;
  try {
    // No openStore/migrations occur until all separate-project and live test-seller proofs succeed.
    const { openStore } = require('../server/store.cjs');
    const { hashPassword } = require('../server/auth.cjs');
    db = openStore({ env: { ...env, BKM_DB_POOL_SIZE: '1' } }); await db.ready;
    let data = await assertDedicatedData(db, state);
    if(!data.users.some(user=>user.role==='ADMIN')&&!passwordValidation(state.admin.password).valid){state.admin.password=newLocalPassword();persist();}
    if (!data.users.some(user => user.role === 'ADMIN')) await db.transaction(async () => {
      await db.prepare('SELECT pg_advisory_xact_lock(164732092)').get();
      assert(Number((await db.prepare('SELECT COUNT(*) count FROM users').get()).count) === 0, 'FRESH_DATABASE_REQUIRED');
      await db.prepare("INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,'ADMIN',?)").run(state.admin.id, state.admin.email, 'Administrador de homologação', await hashPassword(state.admin.password), new Date().toISOString());
    });
    const admin = new SiteClient(); await admin.init(); await admin.checked('/api/auth/login', 'POST', state.admin);
    const integrations = await admin.checked('/api/admin/integrations');
    assert(integrations.email?.externalSend === false && integrations.publicUrl === SANDBOX_URL && integrations.payments?.environment === 'sandbox' && integrations.payments.canCharge === false, 'REMOTE_INTEGRATIONS_UNSAFE');
    const products = await admin.checked('/api/admin/products');
    let product = products.items.find(value => value.sku === SKU);
    if (!product) product = await admin.checked('/api/admin/products', 'POST', fixtureProduct());
    assert(products.items.length <= 1 && product.kind === 'SINGLE' && product.slug === 'homologacao-mp-butterfree' && product.setId === 'sv09' && product.card?.providerId === 'sv09-003' && product.card.number === '003' && product.published && !product.archived && product.variants.length === 1, 'FIXTURE_PRODUCT_CHANGED');
    const variant = product.variants[0];
    assert(variant.language === 'pt' && variant.condition === 'NM' && variant.finish === 'NORMAL' && variant.priceCents === PRICE && Number.isInteger(variant.stock) && variant.stock >= 0 && variant.stock <= 2, 'FIXTURE_PRODUCT_CHANGED');
    if (state.variantId) assert(state.variantId === variant.id && state.productId === product.id, 'PRIVATE_CHECKPOINT_MISMATCH');
    state.variantId = variant.id; state.productId = product.id; persist();
    await admin.checked('/api/admin/settings', 'PUT', fixtureShippingSettings());
    const customer = new SiteClient(); await customer.init();
    data = await assertDedicatedData(db, state);
    const registered = data.users.find(user => user.role === 'CUSTOMER');
    if(!registered&&!passwordValidation(state.buyer.password).valid){state.buyer.password=newLocalPassword();persist();}
    const account = await customer.checked(registered ? '/api/auth/login' : '/api/auth/register', 'POST', { email: state.buyer.email, password: state.buyer.password, name: 'Comprador de homologação' });
    state.buyer.id = account.user?.id; assert(state.buyer.id, 'CUSTOMER_SESSION_INVALID'); persist();
    for (const caseName of ['pixApro', 'pixPending']) {
      const payload = checkoutPayload(state, caseName);
      const result = await customer.request('/api/checkout', 'POST', payload);
      if (!result.ok) { report.cases[caseName] = { httpStatus: result.status, code: /^[A-Z_]{1,80}$/.test(result.data?.error?.code || '') ? result.data.error.code : 'CHECKOUT_INCONCLUSIVE', orderId: null }; saveReport(); fail('CHECKOUT_INCONCLUSIVE_' + result.status); }
      const order = result.data.order; state.cases[caseName].orderId = order.id; persist();
      report.cases[caseName] = { initial: publicOrder(order) }; saveReport();
      const replay = await customer.checked('/api/checkout', 'POST', payload);
      assert(replay.order?.id === order.id && replay.order.payment?.providerId === order.payment?.providerId, 'IDEMPOTENCY_FAILED');
      report.cases[caseName].replaySameOrder = true;
      if (order.payment?.providerId) {
        const { MercadoPagoPaymentProvider } = require('../server/payments.cjs');
        const remote = await new MercadoPagoPaymentProvider({ env }).getPayment(order.payment.providerId, { orderId: order.id, amountCents: PRICE, currency: 'BRL' });
        assert(remote.sandbox === true && remote.sellerId === config.seller, 'REMOTE_PAYMENT_NOT_SANDBOX');
        report.cases[caseName].provider = { providerId: remote.id, paymentStatus: remote.status, sellerMatches: true, sandbox: true, amountCents: remote.amountCents };
      }
      saveReport();
    }
    // Wait for an actual provider callback; GET alone never manufactures an event.
    const approvedId = state.cases.pixApro.orderId;
    report.callbackWait = await waitForApprovalAndWebhook({
      readOrder: signal => customer.checked('/api/account/orders/' + approvedId, 'GET', undefined, { signal }),
      readWebhook: async () => Number((await db.prepare("SELECT COUNT(*) count FROM payment_events e JOIN payments p ON p.id=e.payment_id WHERE p.order_id=? AND e.event_key LIKE 'mercadopago-webhook:%'").get(approvedId)).count) > 0
    });
    saveReport();
    for (const caseName of ['pixApro', 'pixPending']) {
      const id = state.cases[caseName].orderId;
      const before = await customer.checked('/api/account/orders/' + id);
      const webhook = await db.prepare("SELECT COUNT(*) count FROM payment_events e JOIN payments p ON p.id=e.payment_id WHERE p.order_id=? AND e.event_key LIKE 'mercadopago-webhook:%'").get(id);
      report.cases[caseName].webhookReceived = Number(webhook.count) > 0;
      report.cases[caseName].beforeExplicitReconcile = publicOrder(before);
      const reconciled = await customer.checked('/api/account/orders/' + id + '/reconcile', 'POST', {});
      report.cases[caseName].final = publicOrder(reconciled.order);
      const reservations = await db.prepare('SELECT status,quantity FROM inventory_reservations WHERE order_id=?').all(id);
      report.cases[caseName].reservations = reservations.map(value => ({ status: value.status, quantity: value.quantity }));
    }
    const stockBeforeReplay = await db.prepare('SELECT stock FROM variants WHERE id=?').get(state.variantId);
    for (const caseName of ['pixApro', 'pixPending']) {
      const replay = await customer.checked('/api/checkout', 'POST', checkoutPayload(state, caseName));
      assert(replay.order?.id === state.cases[caseName].orderId, 'FINAL_IDEMPOTENCY_FAILED');
      report.cases[caseName].finalReplaySameOrder = true;
    }
    const stock = await db.prepare('SELECT stock FROM variants WHERE id=?').get(state.variantId);
    const committed = await db.prepare("SELECT COALESCE(SUM(quantity),0) quantity FROM inventory_reservations WHERE variant_id=? AND status='COMMITTED'").get(state.variantId);
    const orderCount = Number((await db.prepare('SELECT COUNT(*) count FROM orders').get()).count);
    const movements = await db.prepare('SELECT COALESCE(SUM(-delta),0) quantity FROM stock_movements WHERE variant_id=? AND delta<0').get(state.variantId);
    assert(orderCount === 2 && stock.stock === stockBeforeReplay.stock && stock.stock === 2 - Number(committed.quantity) && stock.stock >= 0 && Number(movements.quantity) === Number(committed.quantity), 'STOCK_OR_ORDER_COUNT_MISMATCH');
    report.stock = { initial: 2, current: stock.stock, committed: Number(committed.quantity), negativeMovementUnits: Number(movements.quantity), unchangedAfterReplay: true, orderCount };
    report.approvedConfirmed = report.cases.pixApro.final.paymentStatus === 'APPROVED';
    report.pendingConfirmed = report.cases.pixPending.final.paymentStatus === 'PENDING';
    report.webhookProven = report.cases.pixApro.webhookReceived;
    report.complete = report.approvedConfirmed && report.pendingConfirmed && report.webhookProven;
    report.finishedAt = new Date().toISOString(); saveReport();
    return report;
  } catch (error) { report.failureCode = /^[A-Z0-9_]{1,100}$/.test(error.code || '') ? error.code : 'HOMOLOGATION_FAILED'; saveReport(); throw error; }
  finally { await db?.close(); }
}

async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  if (options.help) { console.log('node scripts/homologate-mp.cjs [--verify|--run] --project <20 letras> --seller <id>. Lê somente .env.sandbox. Ver docs/HOMOLOGACAO-MP.md.'); return; }
  const filename = path.join(ROOT, '.env.sandbox');
  assert(fs.existsSync(filename), 'SANDBOX_ENV_FILE_REQUIRED');
  const env = parseEnv(fs.readFileSync(filename, 'utf8')); // No process.env merge, no default .env loader.
  const verified = await verifyEnvironment(env, options);
  if (options.mode === 'verify') { console.log(JSON.stringify({ result: 'VERIFIED_READ_ONLY', ...verified })); return; }
  const lockfile = path.join(ROOT, '.env.sandbox.lock');
  let handle;
  try { handle = fs.openSync(lockfile, 'wx', 0o600); }
  catch { fail('SANDBOX_RUN_LOCKED'); }
  try {
    const result = await runHomologation(env, verified);
    console.log(JSON.stringify({ result: result.complete ? 'SANDBOX_SCENARIOS_CONFIRMED' : 'SANDBOX_SCENARIOS_INCOMPLETE', approvedConfirmed: result.approvedConfirmed, pendingConfirmed: result.pendingConfirmed, webhookProven: result.webhookProven, evidence: 'backups/mp-sandbox-report.json' }));
    if (!result.complete) process.exitCode = 2;
  } finally { fs.closeSync(handle); fs.unlinkSync(lockfile); }
}

if (require.main === module) main().catch(error => { console.error(JSON.stringify({ result: 'REFUSED_OR_INCOMPLETE', code: /^[A-Z0-9_]{1,100}$/.test(error.code || '') ? error.code : 'HOMOLOGATION_FAILED' })); process.exitCode = 1; });
module.exports = { parseArguments, validateSandboxEnv, assertTestSeller, assertRemoteConfig, verifyEnvironment, waitForApprovalAndWebhook, createState, validateState, fixtureProduct, checkoutPayload, fixtureShippingSettings, assertDedicatedData, publicOrder };
