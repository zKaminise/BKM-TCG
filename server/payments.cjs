'use strict';

const { createHash, createHmac, timingSafeEqual } = require('node:crypto');
const MP_ORIGIN = 'https://api.mercadopago.com';
const MOCK_OUTCOMES = Object.freeze({ approved: 'APPROVED', pending: 'PENDING', rejected: 'REJECTED', refused: 'REJECTED', cancelled: 'CANCELLED', canceled: 'CANCELLED', expired: 'EXPIRED' });
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{3,100}$/.test(value);
const hash = value => createHash('sha256').update(value).digest('hex');

class PaymentError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.name = 'PaymentError'; this.status = status; this.statusCode = status; this.code = code;
    this.retryable = !!details.retryable; this.retryAfterMs = details.retryAfterMs || null;
    this.reconciliationRequired = !!details.reconciliationRequired;
    this.providerPaymentId = /^ORD[a-zA-Z0-9]{8,100}$/.test(details.providerPaymentId || '') ? details.providerPaymentId : null;
  }
}

function paymentReadiness(env = process.env) {
  const mode = env.BKM_ENVIRONMENT || 'unconfigured';
  if (env.PAYMENT_PROVIDER === 'mock') {
    const enabled = mode === 'demo';
    return { provider: 'mock', enabled, canCharge: false, available: enabled, demo: true, environment: mode, credentialsPresent: false, missing: [],
      outcomes: Object.keys(MOCK_OUTCOMES).filter(key => !['refused', 'canceled'].includes(key)),
      reason: enabled ? 'Demonstração: apenas pagamentos simulados, sem cobranças reais.' : 'O provedor simulado exige BKM_ENVIRONMENT=demo.' };
  }
  const required = ['MERCADO_PAGO_ACCESS_TOKEN', 'MERCADO_PAGO_PUBLIC_KEY', 'MERCADO_PAGO_WEBHOOK_SECRET', 'MERCADO_PAGO_SELLER_ID'];
  const missing = required.filter(key => typeof env[key] !== 'string' || !env[key].trim());
  const environment = env.MERCADO_PAGO_ENVIRONMENT;
  const configured = env.PAYMENT_PROVIDER === 'mercadopago' && env.MERCADO_PAGO_ENABLED === 'true' && missing.length === 0;
  const eligible = (mode === 'staging' && environment === 'sandbox') || (mode === 'production' && environment === 'production' && env.MERCADO_PAGO_PRODUCTION_APPROVED === 'true');
  const hostingDemoOnly = env.HOSTING_DEMO_ONLY === 'true';
  const enabled = !hostingDemoOnly && configured && eligible && /^\d{1,24}$/.test(env.MERCADO_PAGO_SELLER_ID || '');
  return { provider: 'mercadopago', enabled, available: enabled, canCharge: enabled && environment === 'production', demo: false,
    environment: ['sandbox', 'production'].includes(environment) ? environment : 'unconfigured', credentialsPresent: missing.length === 0, missing,
    reason: hostingDemoOnly ? 'Este ambiente de hospedagem permite somente demonstração, sem pagamentos externos.' : enabled ? (environment === 'sandbox' ? 'Mercado Pago em sandbox; exige contas de teste do provedor.' : 'Mercado Pago habilitado para operação comercial validada.') : 'Mercado Pago desativado: configure ambiente, credenciais, vendedor e ativação explícita após validação sandbox.' };
}

function requirePaymentReady(env = process.env) {
  const readiness = paymentReadiness(env);
  if (!readiness.enabled) throw new PaymentError(503, 'PAYMENT_INTEGRATION_PENDING', readiness.reason);
  return readiness;
}

function idempotencyKeyForOrder(orderId, attemptId = 'initial') {
  if (!validId(orderId) || !validId(attemptId)) throw new PaymentError(400, 'PAYMENT_ORDER_INVALID', 'Identificador de pedido ou tentativa inválido.');
  return hash(`bkm-tcg:mercadopago:order:${orderId}:attempt:${attemptId}`);
}

function validatePaymentInput(input = {}) {
  if (!validId(input.orderId) || !Number.isSafeInteger(input.amountCents) || input.amountCents < 1 || input.amountCents > 1000000000 || (input.currency || 'BRL') !== 'BRL') throw new PaymentError(400, 'PAYMENT_INPUT_INVALID', 'Pedido, moeda ou valor de pagamento inválido.');
  if (input.idempotencyKey !== undefined && (typeof input.idempotencyKey !== 'string' || !/^[a-zA-Z0-9_:/-]{1,128}$/.test(input.idempotencyKey))) throw new PaymentError(400, 'PAYMENT_IDEMPOTENCY_INVALID', 'Chave de idempotência inválida.');
  return { ...input, currency: 'BRL', idempotencyKey: input.idempotencyKey || idempotencyKeyForOrder(input.orderId) };
}

class PaymentProvider {
  async createPayment() { throw new PaymentError(503, 'PAYMENT_PROVIDER_UNAVAILABLE', 'Provedor de pagamento indisponível.'); }
  async getPayment() { throw new PaymentError(503, 'PAYMENT_PROVIDER_UNAVAILABLE', 'Provedor de pagamento indisponível.'); }
}

class MockPaymentProvider extends PaymentProvider {
  constructor({ env = process.env, now = () => Date.now() } = {}) {
    super();
    if (env.BKM_ENVIRONMENT !== 'demo' || env.PAYMENT_PROVIDER !== 'mock') throw new PaymentError(503, 'MOCK_REQUIRES_DEMO', 'Pagamentos simulados só podem ser utilizados no ambiente de demonstração.');
    this.env = { BKM_ENVIRONMENT: env.BKM_ENVIRONMENT, PAYMENT_PROVIDER: env.PAYMENT_PROVIDER }; this.now = now;
  }
  assertDemo() {
    if (this.env.BKM_ENVIRONMENT !== 'demo' || this.env.PAYMENT_PROVIDER !== 'mock') throw new PaymentError(503, 'MOCK_REQUIRES_DEMO', 'Simulação desativada fora da demonstração.');
  }
  async createPayment(input) {
    this.assertDemo();
    const payment = validatePaymentInput(input), status = MOCK_OUTCOMES[input.outcome || 'pending'];
    if (!status) throw new PaymentError(400, 'MOCK_OUTCOME_INVALID', 'Resultado de simulação inválido.');
    const id = `mock_${hash(`${payment.orderId}:${payment.idempotencyKey}`).slice(0, 32)}`;
    return { id, provider: 'mock', demo: true, status, orderId: payment.orderId, amountCents: payment.amountCents, currency: 'BRL',
      eventId: `mock_evt_${hash(`${id}:created:${status}`).slice(0, 40)}`, occurredAt: new Date(this.now()).toISOString(),
      expiresAt: new Date(this.now() + 30 * 60 * 1000).toISOString(), label: 'PAGAMENTO SIMULADO — nenhuma cobrança realizada' };
  }
  async simulatePayment({ payment, outcome, eventId } = {}) {
    this.assertDemo();
    if (!payment || payment.provider !== 'mock' || payment.demo !== true || !/^mock_[a-f0-9]{32}$/.test(payment.id || '') || !MOCK_OUTCOMES[outcome]) throw new PaymentError(400, 'MOCK_EVENT_INVALID', 'Pagamento ou evento de demonstração inválido.');
    const status = MOCK_OUTCOMES[outcome];
    if (payment.status !== 'PENDING' && payment.status !== status) throw new PaymentError(409, 'PAYMENT_TERMINAL', 'O pagamento já foi encerrado; crie outro pedido de demonstração.');
    if (eventId !== undefined && !validId(eventId)) throw new PaymentError(400, 'MOCK_EVENT_INVALID', 'Identificador de evento inválido.');
    return { ...payment, status, eventId: `mock_evt_${hash(`${payment.id}:${eventId || status}`).slice(0, 40)}`, occurredAt: new Date(this.now()).toISOString() };
  }
}

function verifyWebhookSignature({ signature, requestId, dataId, secret, now = Date.now(), maxAgeMs = 600000 } = {}) {
  const invalid = () => new PaymentError(401, 'PAYMENT_WEBHOOK_INVALID', 'Assinatura da notificação inválida.');
  if (typeof secret !== 'string' || !secret.trim()) throw new PaymentError(503, 'PAYMENT_WEBHOOK_UNCONFIGURED', 'A validação de notificações de pagamento ainda não foi configurada.');
  if (typeof signature !== 'string' || signature.length > 512 || typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,120}$/.test(requestId) || typeof dataId !== 'string' || !/^[a-zA-Z0-9_-]{1,120}$/.test(dataId)) throw invalid();
  const fields = new Map();
  for (const part of signature.split(',')) {
    const match = part.trim().match(/^(ts|v1)=([^=]+)$/);
    if (!match || fields.has(match[1])) throw invalid();
    fields.set(match[1], match[2]);
  }
  const timestamp = fields.get('ts'), digest = fields.get('v1');
  if (!/^(?:\d{10}|\d{13})$/.test(timestamp || '') || !/^[a-fA-F0-9]{64}$/.test(digest || '') || fields.size !== 2) throw invalid();
  const timestampMs = timestamp.length === 10 ? Number(timestamp) * 1000 : Number(timestamp);
  if (!Number.isFinite(now) || !Number.isFinite(maxAgeMs) || maxAgeMs < 1 || Math.abs(now - timestampMs) > Math.min(maxAgeMs, 86400000)) throw invalid();
  // dataId must come from the URL query, never an unsigned body substitute.
  const normalizedId = dataId.toLowerCase();
  const expected = createHmac('sha256', secret).update(`id:${normalizedId};request-id:${requestId};ts:${timestamp};`).digest(), received = Buffer.from(digest, 'hex');
  if (received.length !== expected.length || !timingSafeEqual(expected, received)) throw invalid();
  return { verified: true, dataId, requestId, timestampMs, replayKey: hash(`mercadopago:${normalizedId}:${requestId}:${timestamp}:${digest.toLowerCase()}`) };
}

function moneyCents(value) {
  if (typeof value !== 'string' || !/^\d{1,10}(?:\.\d{1,2})?$/.test(value)) throw new PaymentError(502, 'PAYMENT_RESPONSE_INVALID', 'O provedor retornou um valor inválido.');
  const [whole, fraction = ''] = value.split('.'); const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) throw new PaymentError(502, 'PAYMENT_RESPONSE_INVALID', 'O provedor retornou um valor inválido.');
  return cents;
}

function retryAfterMs(response) {
  const header = response.headers?.get?.('retry-after'); if (!header) return 1000;
  const seconds = Number(header); return Number.isFinite(seconds) ? Math.max(1000, Math.min(seconds * 1000, 3600000)) : 1000;
}

class MercadoPagoPaymentProvider extends PaymentProvider {
  constructor({ env = process.env, fetchImpl = globalThis.fetch, timeoutMs = 8000, now = () => Date.now() } = {}) {
    super();
    const readiness = requirePaymentReady(env);
    if (readiness.provider !== 'mercadopago') throw new PaymentError(503, 'PAYMENT_PROVIDER_MISMATCH', 'A integração Mercado Pago não está habilitada.');
    if (typeof fetchImpl !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new TypeError('Transporte ou timeout inválido.');
    this.env = { ...env }; this.fetchImpl = fetchImpl; this.timeoutMs = timeoutMs; this.now = now;
  }
  async request(method, path, body, idempotencyKey) {
    requirePaymentReady(this.env);
    const controller = new AbortController(); let timer;
    try {
      const operation = (async () => {
        const response = await this.fetchImpl(`${MP_ORIGIN}${path}`, { method, redirect: 'error', signal: controller.signal,
          headers: { Accept: 'application/json', Authorization: `Bearer ${this.env.MERCADO_PAGO_ACCESS_TOKEN}`, ...(body ? { 'Content-Type': 'application/json', 'X-Idempotency-Key': idempotencyKey } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}) });
        if (Number(response.headers?.get?.('content-length') || 0) > 1048576) throw new PaymentError(502, 'PAYMENT_RESPONSE_INVALID', 'Resposta de pagamento excessiva.');
        let raw;
        if (response.body?.getReader) {
          const reader = response.body.getReader(), chunks = []; let size = 0;
          while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 1048576) { await reader.cancel(); throw new PaymentError(502, 'PAYMENT_RESPONSE_INVALID', 'Resposta de pagamento excessiva.'); } chunks.push(Buffer.from(part.value)); }
          raw = Buffer.concat(chunks).toString('utf8');
        } else raw = await response.text();
        if (Buffer.byteLength(raw) > 1048576) throw new PaymentError(502, 'PAYMENT_RESPONSE_INVALID', 'Resposta de pagamento excessiva.');
        let data; try { data = JSON.parse(raw); } catch { throw new PaymentError(502, 'PAYMENT_RESPONSE_INVALID', 'Resposta de pagamento inválida.'); }
        if (!response.ok && !(response.status === 402 && /^ORD[a-zA-Z0-9]+$/.test(data?.id || ''))) {
          const temporary = [408, 423, 425, 429].includes(response.status) || response.status >= 500;
          throw new PaymentError(response.status === 404 ? 404 : 502, response.status === 409 ? 'PAYMENT_IDEMPOTENCY_CONFLICT' : 'PAYMENT_PROVIDER_ERROR',
            response.status === 409 ? 'A tentativa já existe no provedor; reconcilie antes de tentar novamente.' : 'O provedor não concluiu a solicitação de pagamento.',
            { retryable: temporary, retryAfterMs: temporary ? retryAfterMs(response) : null, reconciliationRequired: method === 'POST' && (temporary || response.status === 409) });
        }
        return data;
      })();
      return await Promise.race([operation, new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new PaymentError(504, 'PAYMENT_TIMEOUT', 'O provedor demorou a responder; consulte o pagamento antes de repetir.', { retryable: true, reconciliationRequired: method === 'POST' })); }, this.timeoutMs); })]);
    } catch (error) {
      if (error instanceof PaymentError) {
        // A malformed success body can still describe a charge that was created.
        if (method === 'POST' && error.code === 'PAYMENT_RESPONSE_INVALID') error.reconciliationRequired = true;
        throw error;
      }
      throw new PaymentError(502, 'PAYMENT_NETWORK_ERROR', 'Falha de comunicação com o provedor de pagamento.', { retryable: true, reconciliationRequired: method === 'POST' });
    } finally { clearTimeout(timer); }
  }
  normalize(data, expected) {
    const input = validatePaymentInput(expected), invalid = () => new PaymentError(409, 'PAYMENT_RECONCILIATION_MISMATCH', 'O pagamento retornado não corresponde ao pedido.');
    if (!data || !/^ORD[a-zA-Z0-9]{8,100}$/.test(data.id || '') || data.external_reference !== input.orderId || String(data.user_id) !== this.env.MERCADO_PAGO_SELLER_ID || data.country_code !== 'BRA' || (data.currency_id !== undefined && data.currency_id !== 'BRL') || moneyCents(data.total_amount) !== input.amountCents) throw invalid();
    if (expected.paymentId && data.id !== expected.paymentId) throw invalid();
    // Orders responses do not always contain live_mode. When present it must match.
    if (data.live_mode !== undefined && data.live_mode !== (this.env.MERCADO_PAGO_ENVIRONMENT === 'production')) throw invalid();
    let status;
    if (data.status === 'processed' && data.status_detail === 'accredited') status = 'APPROVED';
    else status = ({ created: 'PENDING', processing: 'PENDING', action_required: 'PENDING', canceled: 'CANCELLED', expired: 'EXPIRED', failed: 'REJECTED', refunded: 'REFUNDED', charged_back: 'CHARGEBACK' })[data.status] || 'REVIEW';
    const payments = data.transactions?.payments;
    // The transaction's paid_amount can be net of provider fees. Reconcile the
    // gross charged amount against the order, never against the seller payout.
    if (status === 'APPROVED' && (moneyCents(data.total_paid_amount) !== input.amountCents || !Array.isArray(payments) || payments.length !== 1 || payments[0].status !== 'processed' || payments[0].status_detail !== 'accredited' || moneyCents(payments[0].amount) !== input.amountCents)) throw invalid();
    const method = payments?.[0]?.payment_method || {};
    const pix = method.id === 'pix' && typeof method.qr_code === 'string' && method.qr_code.length <= 10000 ? { copyPaste: method.qr_code } : null;
    const updatedAt = typeof data.last_updated_date === 'string' ? data.last_updated_date : null;
    return { id: data.id, provider: 'mercadopago', demo: false, sandbox: this.env.MERCADO_PAGO_ENVIRONMENT === 'sandbox', status, providerStatus: String(data.status || '').slice(0, 40), providerStatusDetail: String(data.status_detail || '').slice(0, 80),
      orderId: input.orderId, amountCents: input.amountCents, currency: 'BRL', sellerId: String(data.user_id), pix,
      eventId: `mp_evt_${hash(`${data.id}:${data.status}:${data.status_detail}:${updatedAt || ''}:${data.total_paid_amount || ''}`).slice(0, 48)}`, providerUpdatedAt: updatedAt && Number.isFinite(Date.parse(updatedAt)) ? updatedAt : null, occurredAt: updatedAt || new Date(this.now()).toISOString() };
  }
  async createPayment(input) {
    const payment = validatePaymentInput(input);
    if (payment.orderId.length > 64) throw new PaymentError(400, 'PAYMENT_ORDER_INVALID', 'Referência de pagamento excede 64 caracteres.');
    const payer = input.payer || {};
    if (typeof payer.email !== 'string' || payer.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payer.email)) throw new PaymentError(400, 'PAYMENT_PAYER_INVALID', 'Informe um e-mail válido para o pagamento.');
    if (this.env.MERCADO_PAGO_ENVIRONMENT === 'sandbox' && !/@testuser\.com$/i.test(payer.email)) throw new PaymentError(400, 'PAYMENT_TEST_ACCOUNT_REQUIRED', 'O sandbox requer um comprador de teste @testuser.com do Mercado Pago.');
    const method = input.method || 'pix'; let paymentMethod;
    if (method === 'pix') paymentMethod = { id: 'pix', type: 'bank_transfer' };
    else if (method === 'card') {
      const card = input.card || {};
      if (!/^[a-zA-Z0-9_-]{8,256}$/.test(card.token || '') || !/^[a-zA-Z0-9_-]{2,40}$/.test(card.paymentMethodId || '') || !['credit_card', 'debit_card'].includes(card.type) || !Number.isInteger(card.installments) || card.installments < 1 || card.installments > 12) throw new PaymentError(400, 'PAYMENT_CARD_INVALID', 'Token, bandeira ou parcelas do cartão inválidos.');
      paymentMethod = { id: card.paymentMethodId, type: card.type, token: card.token, installments: card.installments };
    } else throw new PaymentError(400, 'PAYMENT_METHOD_INVALID', 'Meio de pagamento inválido.');
    const payerBody = { email: payer.email };
    if (payer.identification) {
      if (!['CPF', 'CNPJ'].includes(payer.identification.type) || !/^\d{11,14}$/.test(payer.identification.number || '')) throw new PaymentError(400, 'PAYMENT_PAYER_INVALID', 'Documento do pagador inválido.');
      payerBody.identification = { type: payer.identification.type, number: payer.identification.number };
    }
    const amount = (payment.amountCents / 100).toFixed(2);
    const body = { type: 'online', processing_mode: 'automatic', total_amount: amount, external_reference: payment.orderId, payer: payerBody,
      transactions: { payments: [{ amount, payment_method: paymentMethod, ...(method === 'pix' ? { expiration_time: 'PT30M' } : {}) }] } };
    const data = await this.request('POST', '/v1/orders', body, payment.idempotencyKey);
    // POST does not guarantee seller/account fields. GET is authoritative and
    // verifies the account before any financial state is applied locally.
    const providerPaymentId = /^ORD[a-zA-Z0-9]{8,100}$/.test(data?.id || '') ? data.id : null;
    if (!providerPaymentId) throw new PaymentError(502, 'PAYMENT_RESPONSE_INVALID', 'O provedor não confirmou o identificador da cobrança.', { reconciliationRequired: true });
    try { return await this.getPayment(providerPaymentId, payment); }
    catch (error) {
      if (error instanceof PaymentError) { error.reconciliationRequired = true; error.providerPaymentId = providerPaymentId; throw error; }
      throw new PaymentError(502, 'PAYMENT_RECONCILIATION_REQUIRED', 'A cobrança precisa de confirmação remota.', { reconciliationRequired: true, providerPaymentId });
    }
  }
  async getPayment(paymentId, expected) {
    if (!/^ORD[a-zA-Z0-9]{8,100}$/.test(paymentId || '')) throw new PaymentError(400, 'PAYMENT_ID_INVALID', 'Identificador de pagamento inválido.');
    validatePaymentInput(expected);
    const data = await this.request('GET', `/v1/orders/${encodeURIComponent(paymentId)}`);
    return this.normalize(data, { ...expected, paymentId });
  }
  async reconcileWebhook({ signature, requestId, dataId, expected, now = this.now() } = {}) {
    const proof = verifyWebhookSignature({ signature, requestId, dataId, secret: this.env.MERCADO_PAGO_WEBHOOK_SECRET, now });
    const payment = await this.getPayment(dataId, expected);
    return { ...proof, eventId: payment.eventId, payment };
  }
}

function createPaymentProvider(options = {}) {
  const env = options.env || process.env; requirePaymentReady(env);
  return env.PAYMENT_PROVIDER === 'mock' ? new MockPaymentProvider(options) : new MercadoPagoPaymentProvider(options);
}

module.exports = { PaymentProvider, MockPaymentProvider, MercadoPagoPaymentProvider, PaymentError, paymentReadiness, requirePaymentReady, createPaymentProvider,
  idempotencyKeyForOrder, verifyWebhookSignature, moneyCents, MOCK_OUTCOMES };
