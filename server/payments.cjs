'use strict';

// Security preparation, not a completed payment gateway. No method in this
// module can create a charge, issue Pix, capture funds or change order status.
const { createHash, createHmac, timingSafeEqual } = require('node:crypto');

class PaymentError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'PaymentError'; this.status = status; this.statusCode = status; this.code = code;
  }
}

function paymentReadiness(env = process.env) {
  const required = ['MERCADO_PAGO_ACCESS_TOKEN', 'MERCADO_PAGO_PUBLIC_KEY', 'MERCADO_PAGO_WEBHOOK_SECRET'];
  const missing = required.filter(key => typeof env[key] !== 'string' || !env[key].trim());
  return {
    provider: 'mercadopago', enabled: false, canCharge: false,
    environment: env.MERCADO_PAGO_ENVIRONMENT === 'sandbox' ? 'sandbox' : 'unconfigured',
    credentialsPresent: missing.length === 0, missing,
    reason: 'Pagamento indisponível: falta concluir e validar a integração Orders API em conta de teste, incluindo confirmação remota e processamento transacional de eventos.',
  };
}

function requirePaymentReady() {
  throw new PaymentError(503, 'PAYMENT_INTEGRATION_PENDING', 'Os pagamentos ainda não estão habilitados. Nenhuma cobrança foi criada.');
}

function idempotencyKeyForOrder(orderId) {
  if (typeof orderId !== 'string' || !/^[a-zA-Z0-9_-]{3,100}$/.test(orderId)) throw new PaymentError(400, 'PAYMENT_ORDER_INVALID', 'Identificador de pedido inválido.');
  return createHash('sha256').update(`bkm-tcg:mercadopago:order:${orderId}`).digest('hex');
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
  // Mercado Pago's signed template lowercases alphanumeric data.id values.
  // dataId MUST come from the request URL, never an unsigned body substitute.
  const normalizedId = dataId.toLowerCase();
  const manifest = `id:${normalizedId};request-id:${requestId};ts:${timestamp};`;
  const expected = createHmac('sha256', secret).update(manifest).digest();
  const received = Buffer.from(digest, 'hex');
  if (received.length !== expected.length || !timingSafeEqual(expected, received)) throw invalid();
  return {
    verified: true, dataId, requestId, timestampMs,
    replayKey: createHash('sha256').update(`mercadopago:${normalizedId}:${requestId}:${timestamp}:${digest.toLowerCase()}`).digest('hex'),
  };
}

module.exports = { PaymentError, paymentReadiness, requirePaymentReady, idempotencyKeyForOrder, verifyWebhookSignature };
