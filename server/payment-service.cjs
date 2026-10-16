'use strict';
const crypto = require('node:crypto');
const { MercadoPagoPaymentProvider, PaymentError, paymentReadiness, idempotencyKeyForOrder, verifyWebhookSignature } = require('./payments.cjs');
const uid = () => crypto.randomUUID();
const stamp = () => new Date().toISOString();
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digest = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const parse = value => { try { return JSON.parse(value || '{}'); } catch { throw new PaymentError(500, 'PAYMENT_STATE_INVALID', 'O registro de pagamento precisa de revisão.'); } };
const finalFailure = new Set(['REJECTED', 'CANCELLED', 'EXPIRED']);

function createMercadoPagoService({ db, env = process.env, ApiError = PaymentError, serializeOrder, recordHistory, audit, enqueueEmail, provider: injectedProvider, now = () => Date.now() } = {}) {
  if (!db || typeof serializeOrder !== 'function') throw new TypeError('Banco e serializer de pedidos são obrigatórios.');
  const fail = (status, code, message, fields) => { throw new ApiError(status, code, message, fields); };
  const provider = () => {
    const readiness = paymentReadiness(env);
    if (!readiness.enabled || readiness.provider !== 'mercadopago' || env.BKM_ENVIRONMENT === 'demo') fail(503, 'PAYMENT_UNAVAILABLE', 'Mercado Pago está desativado neste ambiente.');
    return injectedProvider || new MercadoPagoPaymentProvider({ env });
  };
  const expected = row => ({ orderId: row.id, amountCents: row.total_cents, currency: row.currency, ...(row.payment_provider_id ? { paymentId: row.payment_provider_id } : {}) });
  async function history(orderId, status, message, actor) {
    if (recordHistory) return recordHistory(orderId, 'PAYMENT', status, message, actor);
    await db.prepare('INSERT INTO order_history VALUES(?,?,?,?,?,?,?)').run(uid(), orderId, 'PAYMENT', status, message, actor || null, stamp());
  }
  function assertOrder(row) {
    if (!row) fail(404, 'ORDER_NOT_FOUND', 'Pedido não encontrado.');
    if (row.environment === 'demo') fail(409, 'PAYMENT_ENVIRONMENT_MISMATCH', 'Um pedido demonstrativo não pode receber cobrança externa.');
    if (row.currency !== 'BRL' || !Number.isSafeInteger(row.total_cents) || row.total_cents < 1) fail(409, 'PAYMENT_ORDER_INVALID', 'Valores do pedido inválidos.');
  }
  async function mail(row, template, key) {
    if (!enqueueEmail) return;
    const order = await serializeOrder(row), contact = parse(row.contact_json);
    await enqueueEmail({ key, template, to: contact.email, data: { ...order, name: contact.name, customerName: contact.name, orderNumber: order.number, orderId: row.id,
      orderUrl: (env.BKM_PUBLIC_URL || env.PUBLIC_URL || '') + '/conta/pedidos/' + row.id, demo: false } });
  }
  async function attachAttempt(row) {
    let payment = await db.prepare('SELECT * FROM payments WHERE order_id=?' + db.lockSuffix).get(row.id);
    if (!payment) {
      const key = idempotencyKeyForOrder(row.id), id = 'mp_attempt_' + digest(row.id).slice(0, 40), created = stamp();
      const payload = { attemptKey: key, gatewayEnvironment: env.MERCADO_PAGO_ENVIRONMENT, creationState: 'READY', expiresAt: new Date(now() + 30 * 60000).toISOString(), providerPayment: null };
      await db.prepare('INSERT INTO payments VALUES(?,?,?,?,?,?,?,?,?,?)').run(id, row.id, 'mercadopago', 'PENDING', row.total_cents, 'BRL', 'production', JSON.stringify(payload), created, created);
      payment = await db.prepare('SELECT * FROM payments WHERE order_id=?').get(row.id);
    }
    if (payment.provider !== 'mercadopago' || payment.amount_cents !== row.total_cents || payment.currency !== 'BRL') fail(409, 'PAYMENT_ATTEMPT_MISMATCH', 'A tentativa não corresponde ao pedido.');
    assertAttemptEnvironment(payment);
    return payment;
  }
  function assertAttemptEnvironment(payment) {
    const payload = parse(payment.payload_json);
    if (!['sandbox', 'production'].includes(payload.gatewayEnvironment) || payload.gatewayEnvironment !== env.MERCADO_PAGO_ENVIRONMENT) fail(409, 'PAYMENT_ENVIRONMENT_MISMATCH', 'O ambiente desta tentativa difere da configuração atual. Use bancos separados para sandbox e produção.');
  }
  async function preparePayment(orderRow) {
    provider();
    return db.transaction(async () => {
      const row = await db.prepare('SELECT * FROM orders WHERE id=?' + db.lockSuffix).get(orderRow.id);
      assertOrder(row);
      return attachAttempt(row);
    });
  }
  // All callers pass a normalized result that has already been retrieved and
  // checked against our database total/reference/seller by the provider adapter.
  async function apply(remote, { replayKey, actor = null } = {}) {
    return db.transaction(async () => {
      const row = await db.prepare('SELECT * FROM orders WHERE id=?' + db.lockSuffix).get(remote.orderId);
      assertOrder(row);
      const payment = await attachAttempt(row), payload = parse(payment.payload_json);
      if (row.payment_provider_id && row.payment_provider_id !== remote.id) fail(409, 'PAYMENT_ATTEMPT_MISMATCH', 'Já existe outra cobrança associada a este pedido.');
      if (remote.orderId !== row.id || remote.amountCents !== row.total_cents || remote.currency !== 'BRL' || remote.provider !== 'mercadopago' || !/^ORD[a-zA-Z0-9]{8,100}$/.test(remote.id || '') || typeof remote.eventId !== 'string' || remote.eventId.length > 160) fail(409, 'PAYMENT_RECONCILIATION_MISMATCH', 'O pagamento não corresponde ao pedido.');
      const businessKey = 'mercadopago:' + remote.eventId;
      const receiptKey = replayKey ? 'mercadopago-webhook:' + replayKey : null;
      const seen = await db.prepare('SELECT id,payment_id FROM payment_events WHERE event_key=?').get(businessKey);
      const receipt = receiptKey ? await db.prepare('SELECT id,payment_id FROM payment_events WHERE event_key=?').get(receiptKey) : null;
      if ((seen && seen.payment_id !== payment.id) || (receipt && receipt.payment_id !== payment.id)) fail(409, 'PAYMENT_EVENT_CONFLICT', 'Identificador de evento já associado a outro pagamento.');
      if (seen || receipt) {
        if (receiptKey && !receipt) await db.prepare('INSERT INTO payment_events VALUES(?,?,?,?,?,?)').run(uid(), payment.id, receiptKey, remote.status, JSON.stringify({ providerId: remote.id, eventId: remote.eventId, duplicate: true }), stamp());
        return serializeOrder(row);
      }
      let orderStatus = row.status, nextStatus = remote.status;
      const previousStatus = payment.status;
      // A refund or financial review must never erase the fact that stock was
      // committed once. Persist this fact independently of the current status.
      const approvedBefore = payload.approvalSeen === true || payload.stockCommitted === true || ['APPROVED', 'PAID'].includes(previousStatus);
      if (approvedBefore) payload.approvalSeen = true;
      const previousAt = Date.parse(payload.providerPayment?.providerUpdatedAt || '');
      const remoteAt = Date.parse(remote.providerUpdatedAt || '');
      let ignored = Number.isFinite(previousAt) && Number.isFinite(remoteAt) && remoteAt < previousAt;
      if (['REFUNDED', 'CHARGEBACK'].includes(previousStatus) && ['APPROVED', 'PENDING', 'REJECTED', 'CANCELLED', 'EXPIRED'].includes(remote.status)) ignored = true;
      if (ignored) nextStatus = previousStatus;
      // Out-of-order pending/failure notifications cannot undo a credited sale.
      if (approvedBefore && (remote.status === 'PENDING' || finalFailure.has(remote.status))) { nextStatus = previousStatus; ignored = true; }
      if (finalFailure.has(previousStatus) && remote.status === 'PENDING') nextStatus = previousStatus;
      const reservations = await db.prepare("SELECT * FROM inventory_reservations WHERE order_id=? AND status='ACTIVE' ORDER BY variant_id").all(row.id);
      if (nextStatus === 'APPROVED' && !approvedBefore) {
        const items = await db.prepare('SELECT * FROM order_items WHERE order_id=? ORDER BY variant_id').all(row.id);
        let canFulfill = reservations.length === items.length && items.length > 0;
        const locked = [];
        for (const item of reservations) {
          const variant = await db.prepare('SELECT * FROM variants WHERE id=?' + db.lockSuffix).get(item.variant_id);
          const other = await db.prepare("SELECT COALESCE(SUM(quantity),0) units FROM inventory_reservations WHERE variant_id=? AND order_id<>? AND status='ACTIVE' AND expires_at>?").get(item.variant_id, row.id, now());
          const original = items.find(entry => entry.variant_id === item.variant_id);
          if (!variant || item.expires_at <= now() || !original || original.quantity !== item.quantity || variant.stock - Number(other.units) < item.quantity) canFulfill = false;
          locked.push({ item, variant });
        }
        // Lock stock in stable variant order before taking the coupon row lock,
        // matching checkout/admin inventory ordering to avoid lock inversion.
        if (row.coupon_id) {
          const changed = await db.prepare('UPDATE coupons SET used_count=used_count+1 WHERE id=? AND (max_uses IS NULL OR used_count<max_uses)').run(row.coupon_id);
          payload.couponCommitted = changed.changes === 1;
          if (!payload.couponCommitted) canFulfill = false;
        }
        payload.approvalSeen = true;
        if (canFulfill) {
          for (const { item, variant } of locked) {
            const changed = await db.prepare('UPDATE variants SET stock=stock-? WHERE id=? AND stock>=?').run(item.quantity, item.variant_id, item.quantity);
            if (changed.changes !== 1) fail(409, 'STOCK_CHANGED', 'Estoque alterado durante a confirmação. Reconcilie o pedido.');
            await db.prepare('INSERT INTO stock_movements VALUES(?,?,?,?,?,?,?)').run(uid(), item.variant_id, actor, -item.quantity, variant.stock - item.quantity, 'Pagamento Mercado Pago do pedido ' + row.number, stamp());
          }
          await db.prepare("UPDATE inventory_reservations SET status='COMMITTED' WHERE order_id=? AND status='ACTIVE'").run(row.id);
          payload.stockCommitted = true;
          orderStatus = 'CONFIRMED';
        } else {
          // The payment is genuine but stock cannot be promised. Preserve the
          // financial fact and require manual fulfillment/refund, never oversell.
          await db.prepare("UPDATE inventory_reservations SET status='RELEASED' WHERE order_id=? AND status='ACTIVE'").run(row.id);
          orderStatus = 'PAYMENT_REVIEW';
        }
      } else if (finalFailure.has(nextStatus) && !approvedBefore) {
        await db.prepare("UPDATE inventory_reservations SET status='RELEASED' WHERE order_id=? AND status='ACTIVE'").run(row.id);
        orderStatus = nextStatus === 'EXPIRED' ? 'EXPIRED' : 'CANCELLED';
      } else if (['REFUNDED', 'CHARGEBACK', 'REVIEW'].includes(nextStatus)) {
        // Already committed stock is not automatically restocked after shipment.
        await db.prepare("UPDATE inventory_reservations SET status='RELEASED' WHERE order_id=? AND status='ACTIVE'").run(row.id);
        orderStatus = nextStatus === 'REFUNDED' ? 'REFUNDED' : 'PAYMENT_REVIEW';
      }
      payload.providerPayment = { ...(ignored && payload.providerPayment ? payload.providerPayment : remote), status: nextStatus }; payload.creationState = 'CREATED';
      await db.prepare('UPDATE payments SET status=?,payload_json=?,updated_at=? WHERE id=?').run(nextStatus, JSON.stringify(payload), stamp(), payment.id);
      await db.prepare('UPDATE orders SET payment_status=?,payment_provider_id=?,status=?,updated_at=? WHERE id=?').run(nextStatus, remote.id, orderStatus, stamp(), row.id);
      await db.prepare('INSERT INTO payment_events VALUES(?,?,?,?,?,?)').run(uid(), payment.id, businessKey, remote.status, JSON.stringify({ providerId: remote.id, eventId: remote.eventId, status: remote.status }), stamp());
      if (receiptKey) await db.prepare('INSERT INTO payment_events VALUES(?,?,?,?,?,?)').run(uid(), payment.id, receiptKey, remote.status, JSON.stringify({ providerId: remote.id, eventId: remote.eventId }), stamp());
      await history(row.id, nextStatus, ignored ? 'Notificação antiga registrada; estado financeiro e estoque preservados.' : orderStatus === 'PAYMENT_REVIEW' ? 'Pagamento verificado; pedido exige revisão de estoque, cupom ou financeira antes do envio.' : 'Status confirmado diretamente no Mercado Pago: ' + nextStatus + '.', actor);
      if (audit) await audit(actor, 'MERCADO_PAGO_RECONCILED', row.id, { status: nextStatus, fulfillment: orderStatus });
      const updated = await db.prepare('SELECT * FROM orders WHERE id=?').get(row.id);
      if (!approvedBefore && nextStatus === 'APPROVED') await mail(updated, 'payment-approved', 'mp-payment:' + row.id + ':approved');
      else if (previousStatus === 'PENDING' && finalFailure.has(nextStatus)) await mail(updated, 'payment-rejected', 'mp-payment:' + row.id + ':' + nextStatus);
      return serializeOrder(updated);
    });
  }
  async function createPayment(orderRow, paymentInput = {}) {
    const gateway = provider();
    const submissionHash = digest(paymentInput);
    const attempt = await db.transaction(async () => {
      const row = await db.prepare('SELECT * FROM orders WHERE id=?' + db.lockSuffix).get(orderRow.id);
      assertOrder(row);
      if (row.status !== 'PENDING' && !row.payment_provider_id) fail(409, 'PAYMENT_ORDER_CLOSED', 'Este pedido não aceita nova tentativa de pagamento.');
      const payment = await attachAttempt(row), payload = parse(payment.payload_json);
      if (payload.submissionHash && payload.submissionHash !== submissionHash) fail(409, 'PAYMENT_IDEMPOTENCY_CONFLICT', 'Esta tentativa já recebeu dados diferentes. Consulte o pedido antes de tentar novamente.');
      if (payload.providerPayment?.id || row.payment_provider_id) return { row, payment, existing: true };
      if (['SUBMITTING', 'UNKNOWN'].includes(payload.creationState)) fail(409, 'PAYMENT_RECONCILIATION_REQUIRED', 'A tentativa está em processamento. Consulte o pedido ou aguarde a notificação do Mercado Pago.');
      payload.submissionHash = submissionHash; payload.creationState = 'SUBMITTING';
      await db.prepare('UPDATE payments SET payload_json=?,updated_at=? WHERE id=?').run(JSON.stringify(payload), stamp(), payment.id);
      return { row, payment, payload };
    });
    if (attempt.existing) return reconcile(attempt.row.id);
    let remote;
    try {
      // External I/O intentionally happens after committing the local reservation.
      remote = await gateway.createPayment({ ...paymentInput, orderId: attempt.row.id, amountCents: attempt.row.total_cents, currency: 'BRL', idempotencyKey: attempt.payload.attemptKey });
    } catch (error) {
      const ambiguous = error.reconciliationRequired || error.retryable || !(error instanceof PaymentError);
      await db.transaction(async () => {
        const row = await db.prepare('SELECT * FROM orders WHERE id=?' + db.lockSuffix).get(attempt.row.id);
        const payment = await db.prepare('SELECT * FROM payments WHERE order_id=?' + db.lockSuffix).get(row.id);
        const payload = parse(payment.payload_json);
        // A webhook can complete while the creation request is still in flight.
        if (payload.providerPayment?.id || row.payment_provider_id || payment.status !== 'PENDING') return;
        payload.creationState = ambiguous ? 'UNKNOWN' : 'FAILED'; payload.failureCode = String(error.code || 'PAYMENT_FAILED').slice(0, 100);
        if (ambiguous && /^ORD[a-zA-Z0-9]{8,100}$/.test(error.providerPaymentId || '')) await db.prepare('UPDATE orders SET payment_provider_id=? WHERE id=?').run(error.providerPaymentId, row.id);
        await db.prepare('UPDATE payments SET status=?,payload_json=?,updated_at=? WHERE id=?').run(ambiguous ? 'PENDING' : 'REJECTED', JSON.stringify(payload), stamp(), payment.id);
        if (!ambiguous) {
          await db.prepare("UPDATE inventory_reservations SET status='RELEASED' WHERE order_id=? AND status='ACTIVE'").run(row.id);
          await db.prepare("UPDATE orders SET status='CANCELLED',payment_status='REJECTED',updated_at=? WHERE id=?").run(stamp(), row.id);
        }
        await history(row.id, ambiguous ? 'PENDING' : 'REJECTED', ambiguous ? 'Resposta de criação inconclusiva. Aguardando confirmação remota; não gere outra cobrança.' : 'O provedor não criou a cobrança. Reserva de estoque liberada.', null);
      });
      if (ambiguous) fail(503, 'PAYMENT_RECONCILIATION_REQUIRED', 'O resultado ainda não foi confirmado. Acompanhe o pedido; nenhuma nova cobrança será criada automaticamente.');
      fail(error instanceof PaymentError ? error.status : 502, error instanceof PaymentError ? error.code : 'PAYMENT_FAILED', error instanceof PaymentError ? error.message : 'Não foi possível criar o pagamento.');
    }
    try { return await apply(remote); }
    catch {
      // The provider returned a payment, so a local persistence failure cannot
      // be interpreted as a declined charge or release the reserved inventory.
      await db.transaction(async () => {
        const row = await db.prepare('SELECT * FROM orders WHERE id=?' + db.lockSuffix).get(attempt.row.id);
        const payment = await db.prepare('SELECT * FROM payments WHERE order_id=?' + db.lockSuffix).get(row.id);
        const payload = parse(payment.payload_json);
        if (payload.providerPayment?.id || payment.status !== 'PENDING') return;
        payload.creationState = 'UNKNOWN'; payload.failureCode = 'PAYMENT_LOCAL_CONFIRMATION_FAILED';
        if (/^ORD[a-zA-Z0-9]{8,100}$/.test(remote?.id || '')) await db.prepare('UPDATE orders SET payment_provider_id=? WHERE id=?').run(remote.id, row.id);
        await db.prepare('UPDATE payments SET payload_json=?,updated_at=? WHERE id=?').run(JSON.stringify(payload), stamp(), payment.id);
      });
      fail(503, 'PAYMENT_RECONCILIATION_REQUIRED', 'A cobrança foi recebida pelo provedor e aguarda confirmação local. Acompanhe o pedido; não gere outra tentativa.');
    }
  }
  async function reconcile(orderId, actor = null) {
    const gateway = provider(), row = await db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
    assertOrder(row);
    const payment = await db.prepare('SELECT * FROM payments WHERE order_id=?').get(row.id);
    if (!payment || payment.provider !== 'mercadopago') fail(404, 'PAYMENT_NOT_FOUND', 'Tentativa Mercado Pago não encontrada.');
    assertAttemptEnvironment(payment);
    const payload = parse(payment.payload_json), remoteId = row.payment_provider_id || payload.providerPayment?.id;
    if (!remoteId) fail(409, 'PAYMENT_RECONCILIATION_REQUIRED', 'Ainda aguardamos o identificador do provedor. Aguarde o webhook; não crie uma cobrança substituta.');
    const remote = await gateway.getPayment(remoteId, expected(row));
    return apply(remote, { actor });
  }
  async function webhook({ signature, requestId, dataId } = {}) {
    const gateway = provider();
    const proof = verifyWebhookSignature({ signature, requestId, dataId, secret: env.MERCADO_PAGO_WEBHOOK_SECRET, now: now() });
    if (!/^ORD[a-zA-Z0-9]{8,100}$/.test(dataId || '')) fail(400, 'PAYMENT_ID_INVALID', 'Identificador de pagamento inválido.');
    // Fetch signed resource first. An ambiguous create may not have returned its
    // provider ID yet; external_reference then recovers our already saved order.
    const raw = await gateway.request('GET', '/v1/orders/' + encodeURIComponent(dataId));
    const row = await db.prepare('SELECT * FROM orders WHERE id=?').get(raw?.external_reference || '');
    assertOrder(row);
    const remote = gateway.normalize(raw, { ...expected(row), paymentId: dataId });
    return apply(remote, { replayKey: proof.replayKey });
  }
  return { preparePayment, createPayment, reconcile, webhook };
}

module.exports = { createMercadoPagoService };
