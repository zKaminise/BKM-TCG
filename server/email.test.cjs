'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { renderEmail, TEMPLATES, createEmailProvider, DevelopmentEmailProvider, ResendEmailProvider, emailReadiness, createEmailDispatcher, EmailError } = require('./email.cjs');
const demo = { BKM_ENVIRONMENT: 'demo', BKM_PUBLIC_URL: 'https://bkm.example.test' };
const production = { BKM_ENVIRONMENT: 'production', BKM_PUBLIC_URL: 'https://bkm.example.test', EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'unit-only-not-a-real-api-key', RESEND_FROM: 'BKM TCG <pedidos@bkm.example.test>', RESEND_ENABLED: 'true', RESEND_DOMAIN_VERIFIED: 'true' };
const data = { customerName: '<script>alert(1)</script>', orderNumber: 'DEMO-0001', orderId: 'order_unit', items: [{ name: 'Pikachu <img src=x onerror=alert(1)>', quantity: 2, priceCents: 1234 }], subtotalCents: 2468, discountCents: 0, shippingCents: 500, totalCents: 2968, resetUrl: 'https://bkm.example.test/redefinir-senha?token=private-unit-token', verificationUrl:'https://bkm.example.test/conta?token=private-unit-token', trackingCode: 'DEMO-TRACK', trackingUrl: 'javascript:alert(1)' };

test('todos os templates usam identidade BKM, dados escapados e simulação visível', () => {
  for (const template of TEMPLATES) {
    const rendered = renderEmail(template, data, { env: demo });
    assert.match(rendered.subject, /^\[DEMONSTRAÇÃO\]/); assert.match(rendered.html, /bkm-logo-original\.png/);
    assert.match(rendered.html, /#ff3038/); assert.match(rendered.html, /#44e5ed/);
    assert.match(rendered.html, /DEMONSTRAÇÃO/); assert.match(rendered.text, /nenhuma cobrança/);
    assert.equal(rendered.html.includes('<script>'), false); assert.equal(rendered.html.includes('<img src=x'), false);
    assert.equal(rendered.html.includes('href="javascript:'), false);
  }
  assert.throws(() => renderEmail('unknown', data), error => error.code === 'EMAIL_TEMPLATE_INVALID');
  assert.throws(() => renderEmail('password-reset', { resetUrl: 'https://evil.example/reset' }, { env: demo }), error => error.code === 'EMAIL_RESET_URL_INVALID');
});

test('desenvolvimento não usa rede e prévia omite token e mascara destinatário', async () => {
  const provider = new DevelopmentEmailProvider({ env: demo });
  const rendered = renderEmail('password-reset', data, { env: demo });
  const message = { ...rendered, to: 'customer@example.test', data };
  const first = await provider.send(message, { idempotencyKey: 'recovery/unit-user/event1' });
  const second = await provider.send(message, { idempotencyKey: 'recovery/unit-user/event1' });
  assert.equal(first.id, second.id); assert.equal(first.delivered, false); assert.equal(first.preview.externalSend, false);
  assert.equal(first.preview.toMasked, 'c***@example.test');
  assert.equal(JSON.stringify(first.preview).includes('private-unit-token'), false);
  assert.match(first.preview.html, /token de recuperação foi omitido/);
});

test('demo força desenvolvimento mesmo com chave Resend; remetente e domínio são obrigatórios', () => {
  assert.equal(createEmailProvider({ env: { ...production, BKM_ENVIRONMENT: 'demo' } }).name, 'development');
  assert.equal(createEmailProvider({ env: { ...production, HOSTING_DEMO_ONLY: 'true' } }).name, 'development');
  assert.equal(emailReadiness(production).enabled, true);
  for (const patch of [{ RESEND_DOMAIN_VERIFIED: 'false' }, { RESEND_ENABLED: 'false' }, { RESEND_API_KEY: '' }, { RESEND_FROM: 'BKM\r\nBcc: leak@example.test' }, { BKM_ENVIRONMENT: 'demo' }]) {
    assert.equal(emailReadiness({ ...production, ...patch }).externalSend, false);
    assert.throws(() => new ResendEmailProvider({ env: { ...production, ...patch } }), error => error.code === 'EMAIL_PROVIDER_UNCONFIGURED');
  }
});

test('Resend usa idempotência e só confirma aceitação da API, nunca entrega na caixa', async () => {
  let request;
  const provider = new ResendEmailProvider({ env: production, fetchImpl: async (url, options) => { request = { url, options }; return new Response(JSON.stringify({ id: 'unit-accepted-email-id' }), { status: 200 }); } });
  const result = await provider.send({ ...renderEmail('welcome', data, { env: production }), to: 'customer@example.test', data }, { idempotencyKey: 'welcome/unit-user' });
  assert.equal(result.accepted, true); assert.equal(result.delivered, null);
  assert.equal(request.url, 'https://api.resend.com/emails');
  assert.equal(request.options.headers['Idempotency-Key'], 'welcome/unit-user');
  assert.deepEqual(JSON.parse(request.options.body).to, ['customer@example.test']);
  assert.equal(JSON.stringify(result).includes(production.RESEND_API_KEY), false);
  await assert.rejects(provider.send({ ...renderEmail('welcome', data, { env: demo }), to: 'customer@example.test' }, { idempotencyKey: 'demo/no-send' }), error => error.code === 'EMAIL_DEMO_SEND_FORBIDDEN');
});

test('Resend sinaliza retry para 429/5xx/timeout, mantém erro sem segredos e recusa cabeçalho injetado', async () => {
  const message = { ...renderEmail('welcome', data, { env: production }), to: 'customer@example.test' };
  for (const status of [429, 503, 422]) {
    const provider = new ResendEmailProvider({ env: production, fetchImpl: async () => new Response(JSON.stringify({ error: production.RESEND_API_KEY }), { status, headers: { 'retry-after': '30' } }) });
    await assert.rejects(provider.send(message, { idempotencyKey: 'welcome/unit' }), error => { assert.equal(error.retryable, status !== 422); assert.equal(error.message.includes(production.RESEND_API_KEY), false); if (status !== 422) assert.equal(error.retryAfterMs, 30000); return true; });
  }
  const provider = new ResendEmailProvider({ env: production, timeoutMs: 10, fetchImpl: async () => new Promise(() => {}) });
  await assert.rejects(provider.send(message, { idempotencyKey: 'welcome/unit' }), error => error.code === 'EMAIL_TIMEOUT' && error.retryable);
  await assert.rejects(provider.send({ ...message, subject: 'Hello\r\nBcc: leak@example.test' }, { idempotencyKey: 'welcome/unit' }), error => error.code === 'EMAIL_MESSAGE_INVALID');
});

function memoryStore(rows) {
  const actions = [];
  return { actions, async enqueue(row) { actions.push(['enqueue', row]); }, async claimDue(options) { actions.push(['claim', options]); return rows; }, async complete(id, fields) { actions.push(['complete', id, fields]); }, async retry(id, fields) { actions.push(['retry', id, fields]); }, async fail(id, fields) { actions.push(['fail', id, fields]); } };
}

test('outbox mantém chave estável, agenda backoff e encerra falha permanente ou limite de tentativas', async () => {
  const now = Date.parse('2026-10-15T15:00:00Z');
  const rows = [
    { id: 'email1', key: 'event/email1', template: 'welcome', to: 'a@example.test', data, attempts: 0 },
    { id: 'email2', key: 'event/email2', template: 'welcome', to: 'a@example.test', data, attempts: 0 },
    { id: 'email3', key: 'event/email3', template: 'welcome', to: 'a@example.test', data, attempts: 5 },
  ];
  const seen = [], store = memoryStore(rows);
  const provider = { name: 'resend', async send(message, options) { seen.push(options.idempotencyKey); throw new EmailError('EMAIL_UNIT_FAIL', 'safe', { retryable: options.idempotencyKey !== 'event/email2', retryAfterMs: 90000 }); } };
  const dispatcher = createEmailDispatcher({ store, provider, env: production, now: () => now, random: () => 0 });
  assert.deepEqual(await dispatcher.flush(), { processed: 3, sent: 0, previewed: 0, retried: 1, failed: 2 });
  assert.deepEqual(seen, rows.map(row => row.key));
  const retry = store.actions.find(action => action[0] === 'retry');
  assert.equal(retry[2].nextAttemptAt, now + 90000); assert.equal(retry[2].attempts, 1);
  assert.equal(store.actions.filter(action => action[0] === 'fail').length, 2);
});

test('outbox bloqueia reenvio ambíguo depois da janela de idempotência e conclui preview privado', async () => {
  const now = Date.parse('2026-10-15T15:00:00Z');
  const row = { id: 'old-email', key: 'event/old-email', template: 'welcome', to: 'a@example.test', data, attempts: 1, createdAt: new Date(now - 24 * 3600000).toISOString() };
  const store = memoryStore([row]); let sends = 0;
  const dispatcher = createEmailDispatcher({ store, env: production, now: () => now, provider: { name: 'resend', async send() { sends++; } } });
  assert.equal((await dispatcher.flush()).failed, 1); assert.equal(sends, 0);
  assert.equal(store.actions.find(action => action[0] === 'fail')[2].errorCode, 'EMAIL_IDEMPOTENCY_WINDOW_EXPIRED');
  const previewStore = memoryStore([{ ...row, attempts: 0 }]);
  const dev = createEmailDispatcher({ store: previewStore, env: demo, now: () => now });
  assert.equal((await dev.flush()).previewed, 1);
  assert.equal(previewStore.actions.find(action => action[0] === 'complete')[2].preview.externalSend, false);
});
