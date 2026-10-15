'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { paymentReadiness, requirePaymentReady, idempotencyKeyForOrder, verifyWebhookSignature } = require('./payments.cjs');
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

test('pagamentos permanecem desabilitados mesmo com variáveis preenchidas; nenhum segredo é retornado', () => {
  const env = { MERCADO_PAGO_ACCESS_TOKEN: 'test-access-secret', MERCADO_PAGO_PUBLIC_KEY: 'test-public', MERCADO_PAGO_WEBHOOK_SECRET: secret, MERCADO_PAGO_ENVIRONMENT: 'sandbox' };
  const result = paymentReadiness(env);
  assert.equal(result.enabled, false); assert.equal(result.canCharge, false); assert.equal(result.credentialsPresent, true);
  assert.equal(JSON.stringify(result).includes('test-access-secret'), false);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(paymentReadiness({}).missing.length, 3);
  assert.throws(requirePaymentReady, error => error.status === 503 && error.code === 'PAYMENT_INTEGRATION_PENDING');
});
