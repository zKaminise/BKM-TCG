'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { paymentReadiness, requirePaymentReady, idempotencyKeyForOrder, verifyWebhookSignature, createPaymentProvider, MockPaymentProvider, MercadoPagoPaymentProvider } = require('./payments.cjs');
const secret = 'unit-test-secret-not-a-real-credential';
const ts = '1792060000000', requestId = 'request-unit-test', dataId = 'ORDUNIT123';
const signature = `ts=${ts},v1=${createHmac('sha256', secret).update(`id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`).digest('hex')}`;
const valid = { signature, requestId, dataId, secret, now: Number(ts) };

test('assinatura válida de order alfanumérica usa ID em minúsculas e comparação segura', () => {
  const result = verifyWebhookSignature(valid);
  assert.equal(result.verified, true);
  assert.equal(result.dataId, dataId);
  assert.equal(result.replayKey.length, 64);
  assert.equal(verifyWebhookSignature(valid).replayKey, result.replayKey);
});

test('assinatura adulterada, cabeçalhos ausentes/duplicados e replay antigo são rejeitados', () => {
  for (const change of [
    { dataId: 'ORDOTHER' }, { requestId: 'other-request' }, { signature: signature.replace(/.$/, signature.endsWith('0') ? '1' : '0') },
    { signature: `${signature},ts=${ts}` }, { signature: 'ts=1,v1=abc' }, { requestId: undefined }, { now: Number(ts) + 600001 },
  ]) assert.throws(() => verifyWebhookSignature({ ...valid, ...change }), error => error.status === 401);
  assert.throws(() => verifyWebhookSignature({ ...valid, secret: '' }), error => error.status === 503);
});

test('idempotência é estável por pedido e diferente para outro pedido', () => {
  assert.equal(idempotencyKeyForOrder('order_123'), idempotencyKeyForOrder('order_123'));
  assert.notEqual(idempotencyKeyForOrder('order_123'), idempotencyKeyForOrder('order_124'));
  assert.throws(() => idempotencyKeyForOrder('../bad'), error => error.status === 400);
});

test('credenciais sozinhas nunca habilitam pagamentos e nenhum segredo é retornado', () => {
  const env = { MERCADO_PAGO_ACCESS_TOKEN: 'test-access-secret', MERCADO_PAGO_PUBLIC_KEY: 'test-public', MERCADO_PAGO_WEBHOOK_SECRET: secret, MERCADO_PAGO_ENVIRONMENT: 'sandbox' };
  const result = paymentReadiness(env);
  assert.equal(result.enabled, false); assert.equal(result.canCharge, false); assert.equal(result.credentialsPresent, false);
  assert.equal(JSON.stringify(result).includes('test-access-secret'), false);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(paymentReadiness({}).missing.length, 4);
  assert.throws(requirePaymentReady, error => error.status === 503 && error.code === 'PAYMENT_INTEGRATION_PENDING');
});

const demo = { BKM_ENVIRONMENT: 'demo', PAYMENT_PROVIDER: 'mock' };
const staging = { BKM_ENVIRONMENT: 'staging', PAYMENT_PROVIDER: 'mercadopago', MERCADO_PAGO_ENABLED: 'true', MERCADO_PAGO_ENVIRONMENT: 'sandbox', MERCADO_PAGO_ACCESS_TOKEN: 'unit-only-not-a-credential', MERCADO_PAGO_PUBLIC_KEY: 'unit-only-public', MERCADO_PAGO_WEBHOOK_SECRET: secret, MERCADO_PAGO_SELLER_ID: '12345678' };
const input = { orderId: 'order_unit_123', amountCents: 12345, currency: 'BRL', payer: { email: 'buyer@testuser.com' }, method: 'pix' };
const remoteId = 'ORD01UNITTEST123456789';
function remote(patch = {}) {
  return { id: remoteId, external_reference: input.orderId, total_amount: '123.45', total_paid_amount: '123.45', country_code: 'BRA', user_id: staging.MERCADO_PAGO_SELLER_ID, status: 'processed', status_detail: 'accredited', last_updated_date: '2026-10-15T15:00:00.000Z', transactions: { payments: [{ id: 'PAY01UNITTEST123', status: 'processed', status_detail: 'accredited', amount: '123.45', paid_amount: '123.45', payment_method: { id: 'pix', type: 'bank_transfer', qr_code: 'unit-test-reference-not-a-real-pix' } }] }, ...patch };
}
const json = (data, status = 200, headers) => new Response(JSON.stringify(data), { status, headers });

test('mock só existe em demonstração explícita e todos os resultados são identificados', async () => {
  for (const env of [{}, { ...demo, BKM_ENVIRONMENT: 'production' }, { ...demo, BKM_ENVIRONMENT: 'staging' }]) {
    assert.throws(() => new MockPaymentProvider({ env }), error => error.code === 'MOCK_REQUIRES_DEMO');
    assert.equal(paymentReadiness(env).enabled, false);
  }
  const provider = createPaymentProvider({ env: demo, now: () => Number(ts) });
  assert.equal(paymentReadiness(demo).canCharge, false);
  for (const outcome of ['approved', 'pending', 'rejected', 'cancelled', 'expired']) {
    const payment = await provider.createPayment({ ...input, outcome });
    assert.equal(payment.status, outcome.toUpperCase()); assert.equal(payment.demo, true);
    assert.match(payment.label, /SIMULADO/); assert.equal(payment.pix, undefined);
    assert.equal((await provider.createPayment({ ...input, outcome })).id, payment.id);
  }
  await assert.rejects(provider.createPayment({ ...input, amountCents: 1.2 }), error => error.status === 400);
  await assert.rejects(provider.createPayment({ ...input, outcome: 'refund-all' }), error => error.status === 400);
  const pending = await provider.createPayment(input), approved = await provider.simulatePayment({ payment: pending, outcome: 'approved' });
  assert.equal(approved.status, 'APPROVED');
  await assert.rejects(provider.simulatePayment({ payment: approved, outcome: 'cancelled' }), error => error.status === 409);
  await assert.rejects(provider.simulatePayment({ payment: { ...pending, demo: false }, outcome: 'approved' }), error => error.status === 400);
});

test('produção exige ambiente coerente, habilitação e aprovação explícitas', () => {
  assert.equal(paymentReadiness(staging).enabled, true);
  assert.equal(paymentReadiness(staging).canCharge, false);
  assert.equal(paymentReadiness({ ...staging, BKM_ENVIRONMENT: 'demo' }).enabled, false);
  assert.equal(paymentReadiness({ ...staging, BKM_ENVIRONMENT: 'production' }).enabled, false);
  const production = { ...staging, BKM_ENVIRONMENT: 'production', MERCADO_PAGO_ENVIRONMENT: 'production' };
  assert.equal(paymentReadiness(production).enabled, false);
  assert.equal(paymentReadiness({ ...production, MERCADO_PAGO_PRODUCTION_APPROVED: 'true' }).canCharge, true);
  assert.equal(paymentReadiness({ ...production, MERCADO_PAGO_PRODUCTION_APPROVED: 'true', HOSTING_DEMO_ONLY: 'true' }).enabled, false);
  assert.equal(paymentReadiness({ ...staging, HOSTING_DEMO_ONLY: 'true' }).enabled, false);
});

test('Orders Pix envia centavos exatos e idempotência estável, sem persistir resposta sensível', async () => {
  const calls = [];
  const provider = new MercadoPagoPaymentProvider({ env: staging, fetchImpl: async (url, options) => { calls.push({ url, options }); return json(remote()); } });
  const payment = await provider.createPayment(input);
  assert.equal(payment.status, 'APPROVED'); assert.equal(payment.sandbox, true); assert.equal(payment.amountCents, 12345);
  assert.equal(payment.pix.copyPaste, 'unit-test-reference-not-a-real-pix');
  assert.equal(calls[0].url, 'https://api.mercadopago.com/v1/orders');
  assert.equal(calls[0].options.headers['X-Idempotency-Key'], idempotencyKeyForOrder(input.orderId));
  assert.equal(JSON.parse(calls[0].options.body).total_amount, '123.45');
  assert.deepEqual(JSON.parse(calls[0].options.body).transactions.payments[0].payment_method, { id: 'pix', type: 'bank_transfer' });
  assert.equal(JSON.stringify(payment).includes(staging.MERCADO_PAGO_ACCESS_TOKEN), false);
  await assert.rejects(provider.createPayment({ ...input, payer: { email: 'real@example.com' } }), error => error.code === 'PAYMENT_TEST_ACCOUNT_REQUIRED');
});

test('cartão usa apenas token de SDK e resposta 402 de order existente é reconciliável', async () => {
  let body;
  const provider = new MercadoPagoPaymentProvider({ env: staging, fetchImpl: async (_, options) => { if(options.method==='POST') body = JSON.parse(options.body); return json(remote({ status: 'failed', status_detail: 'failed', total_paid_amount: '0.00', transactions: { payments: [] } }), options.method==='POST'?402:200); } });
  const payment = await provider.createPayment({ ...input, method: 'card', card: { token: 'unit-sdk-token-not-card-data', paymentMethodId: 'visa', type: 'credit_card', installments: 2 } });
  assert.equal(payment.status, 'REJECTED'); assert.equal(body.transactions.payments[0].payment_method.installments, 2);
  assert.equal(JSON.stringify(payment).includes('unit-sdk-token'), false);
  await assert.rejects(provider.createPayment({ ...input, method: 'card', card: { number: '4111111111111111', cvv: '123' } }), error => error.code === 'PAYMENT_CARD_INVALID');
});

test('criação consulta o recurso para validar vendedor ausente no POST e aceita repasse líquido de taxas', async () => {
  const calls=[];
  const provider = new MercadoPagoPaymentProvider({env:staging,fetchImpl:async(url,options)=>{
    calls.push([url,options.method]);
    if(options.method==='POST') return json({id:remoteId,status:'processed',total_amount:'123.45'});
    const data=remote();data.transactions.payments[0].paid_amount='119.20';
    return json(data);
  }});
  assert.equal((await provider.createPayment(input)).status,'APPROVED');
  assert.deepEqual(calls.map(x=>x[1]),['POST','GET']);
  assert.equal(calls[1][0],'https://api.mercadopago.com/v1/orders/'+remoteId);
});

test('resposta criada sem confirmação GET permanece ambígua e conserva identificador para reconciliação',async()=>{
  const provider=new MercadoPagoPaymentProvider({env:staging,fetchImpl:async(_,options)=>options.method==='POST'?json({id:remoteId}):json({error:'not available'},503)});
  await assert.rejects(provider.createPayment(input),error=>error.reconciliationRequired&&error.providerPaymentId===remoteId);
  for(const response of [()=>new Response('not json',{status:200}),()=>json({status:'created'})]){
    const malformed=new MercadoPagoPaymentProvider({env:staging,fetchImpl:async()=>response()});
    await assert.rejects(malformed.createPayment(input),error=>error.reconciliationRequired&&error.code==='PAYMENT_RESPONSE_INVALID');
  }
});

test('reconciliação recusa outra conta, referência, país, valor ou aprovação sem baixa financeira', async () => {
  for (const patch of [{ user_id: 'other' }, { external_reference: 'other' }, { country_code: 'ARG' }, { currency_id: 'USD' }, { total_amount: '1.00' }, { total_paid_amount: '0.00' }, { live_mode: true }, { transactions: { payments: [{ status: 'processing', status_detail: 'in_process', paid_amount: '123.45' }] } }]) {
    const provider = new MercadoPagoPaymentProvider({ env: staging, fetchImpl: async () => json(remote(patch)) });
    await assert.rejects(provider.getPayment(remoteId, input), error => error.code === 'PAYMENT_RECONCILIATION_MISMATCH');
  }
  const provider = new MercadoPagoPaymentProvider({ env: staging, fetchImpl: async () => json(remote({ status: 'processed', status_detail: 'partially_refunded' })) });
  assert.equal((await provider.getPayment(remoteId, input)).status, 'REVIEW');
});

test('webhook autenticado consulta recurso remoto e ignora corpo; repetições têm mesmo evento', async () => {
  let calls = 0;
  const provider = new MercadoPagoPaymentProvider({ env: staging, now: () => Number(ts), fetchImpl: async () => { calls++; return json(remote()); } });
  const signed = `ts=${ts},v1=${createHmac('sha256', secret).update(`id:${remoteId.toLowerCase()};request-id:${requestId};ts:${ts};`).digest('hex')}`;
  const notification = { signature: signed, requestId, dataId: remoteId, expected: input, body: { status: 'failed' } };
  const first = await provider.reconcileWebhook(notification), second = await provider.reconcileWebhook(notification);
  assert.equal(first.payment.status, 'APPROVED'); assert.equal(first.replayKey, second.replayKey); assert.equal(first.eventId, second.eventId); assert.equal(calls, 2);
  await assert.rejects(provider.reconcileWebhook({ ...notification, dataId: 'ORDDIFFERENT123' }), error => error.status === 401);
  assert.equal(calls, 2);
});

test('falhas não vazam payload ou token; timeout/conflito exigem reconciliação e rate limit respeita Retry-After', async () => {
  const cases = [
    { fetchImpl: async () => { throw new Error(`secret ${staging.MERCADO_PAGO_ACCESS_TOKEN}`); }, code: 'PAYMENT_NETWORK_ERROR' },
    { fetchImpl: async () => new Promise(() => {}), code: 'PAYMENT_TIMEOUT', timeoutMs: 15 },
    { fetchImpl: async () => json({ error: staging.MERCADO_PAGO_ACCESS_TOKEN }, 409), code: 'PAYMENT_IDEMPOTENCY_CONFLICT' },
    { fetchImpl: async () => json({ error: staging.MERCADO_PAGO_ACCESS_TOKEN }, 429, { 'retry-after': '7' }), code: 'PAYMENT_PROVIDER_ERROR', retry: 7000 },
  ];
  for (const item of cases) {
    const provider = new MercadoPagoPaymentProvider({ env: staging, ...item });
    await assert.rejects(provider.createPayment(input), error => { assert.equal(error.code, item.code); assert.equal(error.message.includes(staging.MERCADO_PAGO_ACCESS_TOKEN), false); assert.equal(error.reconciliationRequired, true); if (item.retry) assert.equal(error.retryAfterMs, item.retry); return true; });
  }
});
test('auditoria Orders distingue expiração de cancelamento e permite nome Pix de teste sem simular aprovação local',async()=>{
  for(const status of ['canceled','failed']) {
    const provider=new MercadoPagoPaymentProvider({env:staging,fetchImpl:async()=>json(remote({status,status_detail:'expired',total_paid_amount:'0.00'}))});
    assert.equal((await provider.getPayment(remoteId,input)).status,'EXPIRED');
  }
  let posted;
  const provider=new MercadoPagoPaymentProvider({env:staging,fetchImpl:async(_,options)=>{if(options.method==='POST')posted=JSON.parse(options.body);return json(remote({status:'action_required',status_detail:'waiting_transfer',total_paid_amount:'0.00'}));}});
  const result=await provider.createPayment({...input,payer:{email:'buyer@testuser.com',firstName:'APRO'}});
  assert.equal(posted.payer.first_name,'APRO');assert.equal(result.status,'PENDING');
  assert.equal(JSON.stringify(result).includes('APRO'),false);
  for(const identification of [{type:'CPF',number:'12345678901234'},{type:'CNPJ',number:'12345678901'},{type:'CPF',number:'123456789012'}])await assert.rejects(provider.createPayment({...input,payer:{email:'buyer@testuser.com',identification}}),error=>error.code==='PAYMENT_PAYER_INVALID');
  await assert.rejects(provider.createPayment({...input,payer:{email:'buyer@testuser.com',firstName:'APRO\r\nInjected'}}),error=>error.code==='PAYMENT_PAYER_INVALID');
});
