'use strict';
const crypto = require('node:crypto');
const { MercadoPagoPaymentProvider, PaymentError, paymentReadiness, idempotencyKeyForOrder, verifyWebhookSignature, RESERVATION_MS } = require('./payments.cjs');
const uid = () => crypto.randomUUID();
const stamp = () => new Date().toISOString();
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digest = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const parse = value => { try { return JSON.parse(value || '{}'); } catch { throw new PaymentError(500, 'PAYMENT_STATE_INVALID', 'O registro de pagamento precisa de revisão.'); } };
const finalFailure = new Set(['REJECTED', 'CANCELLED', 'EXPIRED']);

function createMercadoPagoService({ db, env = process.env, ApiError = PaymentError, serializeOrder, recordHistory, audit, enqueueEmail, provider: injectedProvider, now = () => Date.now() } = {}) {
  if (!db || typeof serializeOrder !== 'function') throw new TypeError('Banco e serializer de pedidos são obrigatórios.');
  const fail = (status, code, message, fields) => { throw new ApiError(status, code, message, fields); };
  const provider = ({deadlineAt}={}) => {
    const readiness = paymentReadiness(env);
    if (!readiness.enabled || readiness.provider !== 'mercadopago' || env.BKM_ENVIRONMENT === 'demo') fail(503, 'PAYMENT_UNAVAILABLE', 'Mercado Pago está desativado neste ambiente.');
    if(injectedProvider)return deadlineAt!==undefined&&typeof injectedProvider.withDeadline==='function'?injectedProvider.withDeadline(deadlineAt):injectedProvider;
    return new MercadoPagoPaymentProvider({ env,deadlineAt });
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
  async function approvedEmails(row) {
    await mail(row, 'payment-approved', 'mp-payment:' + row.id + ':approved');
    if (row.status === 'CONFIRMED') await mail(row, 'order-preparing', 'order:' + row.id + ':preparing');
    if (!enqueueEmail) return;
    const order = await serializeOrder(row), contact = parse(row.contact_json);
    const admins = await db.prepare("SELECT id,email,name,profile_json FROM users WHERE role='ADMIN' ORDER BY id").all();
    for (const admin of admins) {
      const configured=parse(admin.profile_json).notificationEmail;
      const to=typeof configured==='string'&&configured.length<=254&&/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(configured.trim())?configured.trim().toLowerCase():admin.email;
      await enqueueEmail({key:'order:'+row.id+':admin-paid:'+admin.id,template:'admin-order-paid',to,data:{...order,name:admin.name,customerName:contact.name,customerEmail:contact.email,needsReview:row.status!=='CONFIRMED',orderNumber:row.number,orderId:row.id,orderUrl:(env.BKM_PUBLIC_URL || env.PUBLIC_URL || '')+'/admin/pedidos/'+row.id,demo:false}});
    }
  }
  async function attachAttempt(row) {
    let payment = await db.prepare('SELECT * FROM payments WHERE order_id=?' + db.lockSuffix).get(row.id);
    if (!payment) {
      const key = idempotencyKeyForOrder(row.id), id = 'mp_attempt_' + digest(row.id).slice(0, 40), created = stamp();
      const deadline = Date.parse(row.created_at) + RESERVATION_MS;
      const payload = { attemptKey: key, gatewayEnvironment: env.MERCADO_PAGO_ENVIRONMENT, creationState: 'READY', expiresAt: new Date(deadline).toISOString(), providerPayment: null };
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
  async function preparePayment(orderRow, details = {}) {
    provider();
    return db.transaction(async () => {
      const row = await db.prepare('SELECT * FROM orders WHERE id=?' + db.lockSuffix).get(orderRow.id);
      assertOrder(row);
      const payment = await attachAttempt(row);
      if (['pix','card'].includes(details.method)) {
        const payload=parse(payment.payload_json);payload.method=details.method;
        await db.prepare('UPDATE payments SET payload_json=? WHERE id=?').run(JSON.stringify(payload),payment.id);
      }
      return payment;
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
      if (payload.localExpired && !approvedBefore && finalFailure.has(remote.status)) nextStatus = 'EXPIRED';
      const reservations = await db.prepare("SELECT * FROM inventory_reservations WHERE order_id=? AND status='ACTIVE' ORDER BY variant_id").all(row.id);
      if (nextStatus === 'APPROVED' && !approvedBefore) {
        const items = await db.prepare('SELECT * FROM order_items WHERE order_id=? ORDER BY variant_id').all(row.id);
        const deadline = Math.min(Date.parse(payload.expiresAt), Date.parse(row.created_at)+RESERVATION_MS);
        // last_updated_date is not advertised as the payment time. An APPROVED
        // resource whose last update was already before the deadline is only a
        // conservative indication of an on-time payment, never a fabricated
        // approval timestamp. Released or reallocated reservations still fail.
        const observedOnTime = Number.isFinite(remoteAt) && remoteAt <= deadline;
        let canFulfill = reservations.length === items.length && items.length > 0 && (!payload.localExpired || observedOnTime) && (now() <= deadline || observedOnTime);
        const locked = [];
        for (const item of reservations) {
          const variant = await db.prepare('SELECT * FROM variants WHERE id=?' + db.lockSuffix).get(item.variant_id);
          const other = await db.prepare("SELECT COALESCE(SUM(quantity),0) units FROM inventory_reservations WHERE variant_id=? AND order_id<>? AND status='ACTIVE' AND expires_at>?").get(item.variant_id, row.id, now());
          const original = items.find(entry => entry.variant_id === item.variant_id);
          if (!variant || item.expires_at <= now() && !observedOnTime || !original || original.quantity !== item.quantity || variant.stock - Number(other.units) < item.quantity) canFulfill = false;
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
        orderStatus = 'CANCELLED';
      } else if (['REFUNDED', 'CHARGEBACK', 'REVIEW'].includes(nextStatus)) {
        // Already committed stock is not automatically restocked after shipment.
        await db.prepare("UPDATE inventory_reservations SET status='RELEASED' WHERE order_id=? AND status='ACTIVE'").run(row.id);
        orderStatus = nextStatus === 'REFUNDED' ? 'REFUNDED' : 'PAYMENT_REVIEW';
      }
      payload.providerPayment = { ...(ignored && payload.providerPayment ? payload.providerPayment : remote), status: nextStatus }; payload.creationState = 'CREATED';
      await db.prepare('UPDATE payments SET status=?,payload_json=?,updated_at=? WHERE id=?').run(nextStatus, JSON.stringify(payload), stamp(), payment.id);
      const shippingStatus = !approvedBefore && nextStatus === 'APPROVED' && orderStatus === 'CONFIRMED' ? 'PROCESSING' : row.shipping_status;
      await db.prepare('UPDATE orders SET payment_status=?,payment_provider_id=?,status=?,shipping_status=?,updated_at=? WHERE id=?').run(nextStatus, remote.id, orderStatus, shippingStatus, stamp(), row.id);
      if (shippingStatus === 'PROCESSING' && row.shipping_status !== 'PROCESSING') {
        await db.prepare("UPDATE shipments SET status='PROCESSING',updated_at=? WHERE order_id=?").run(stamp(),row.id);
        await db.prepare('INSERT INTO order_history VALUES(?,?,?,?,?,?,?)').run(uid(),row.id,'SHIPPING','PROCESSING','Pagamento confirmado. Pedido em separação.',actor,stamp());
      }
      await db.prepare('INSERT INTO payment_events VALUES(?,?,?,?,?,?)').run(uid(), payment.id, businessKey, remote.status, JSON.stringify({ providerId: remote.id, eventId: remote.eventId, status: remote.status }), stamp());
      if (receiptKey) await db.prepare('INSERT INTO payment_events VALUES(?,?,?,?,?,?)').run(uid(), payment.id, receiptKey, remote.status, JSON.stringify({ providerId: remote.id, eventId: remote.eventId }), stamp());
      await history(row.id, nextStatus, ignored ? 'Notificação antiga registrada; estado financeiro e estoque preservados.' : orderStatus === 'PAYMENT_REVIEW' ? 'Pagamento verificado; pedido exige revisão de estoque, cupom ou financeira antes do envio.' : 'Status confirmado diretamente no Mercado Pago: ' + nextStatus + '.', actor);
      if (audit) await audit(actor, 'MERCADO_PAGO_RECONCILED', row.id, { status: nextStatus, fulfillment: orderStatus });
      const updated = await db.prepare('SELECT * FROM orders WHERE id=?').get(row.id);
      if (!approvedBefore && nextStatus === 'APPROVED') await approvedEmails(updated);
      else if (!ignored && nextStatus === 'REFUNDED' && previousStatus !== 'REFUNDED') await mail(updated, 'order-refunded', 'mp-payment:' + row.id + ':refunded');
      else if (!ignored && previousStatus === 'PENDING' && nextStatus === 'CANCELLED') await mail(updated, 'order-cancelled', 'mp-payment:' + row.id + ':CANCELLED');
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
      const deadline=Math.min(Date.parse(payload.expiresAt),Date.parse(row.created_at)+RESERVATION_MS);
      if (now() >= deadline && !payload.providerPayment?.id && !row.payment_provider_id) fail(409,'PAYMENT_EXPIRED','O prazo de 15 minutos expirou. O pedido foi encerrado; faça um novo pedido para reservar os itens disponíveis.');
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
  async function expireDue({orderId,orderIds,limit=30,deadlineAt}={}) {
    if(env.BKM_ENVIRONMENT==='demo') return {expired:0,reconciled:0,cancelled:0,pending:0};
    if(!['sandbox','production'].includes(env.MERCADO_PAGO_ENVIRONMENT))return {expired:0,reconciled:0,cancelled:0,pending:0};
    if(deadlineAt!==undefined&&!Number.isFinite(deadlineAt))fail(422,'PAYMENT_DEADLINE_INVALID','Prazo operacional inválido.');
    const maximum=Math.max(1,Math.min(200,Number.isInteger(limit)?limit:30));
    const selectedIds=Array.isArray(orderIds)?[...new Set(orderIds.filter(id=>typeof id==='string'))].slice(0,200):null;
    if(selectedIds&&!selectedIds.length)return {expired:0,reconciled:0,cancelled:0,pending:0};
    // Both engines can use the indexed reservation deadline. Expired remote
    // attempts whose cancellation was inconclusive are retried on later jobs.
    const candidates=await db.prepare("SELECT o.*,p.payload_json expiry_payload FROM orders o JOIN payments p ON p.order_id=o.id WHERE p.provider='mercadopago' AND p.payload_json LIKE ? AND ((o.status='PENDING' AND o.payment_status='PENDING' AND (EXISTS(SELECT 1 FROM inventory_reservations r WHERE r.order_id=o.id AND r.status='ACTIVE' AND r.expires_at<=?) OR o.created_at<=?)) OR (o.status='CANCELLED' AND o.payment_status='EXPIRED' AND o.payment_provider_id IS NOT NULL AND p.payload_json NOT LIKE ?))"+(orderId?' AND o.id=?':'')+(selectedIds?' AND o.id IN('+selectedIds.map(()=>'?').join(',')+')':'')+" ORDER BY CASE WHEN o.status='PENDING' THEN 0 ELSE 1 END,o.updated_at,o.id LIMIT ?").all('%"gatewayEnvironment":"'+env.MERCADO_PAGO_ENVIRONMENT+'"%',now(),new Date(now()-RESERVATION_MS).toISOString(),'%"expiryCancelState":"DONE"%',...(orderId?[orderId]:[]),...(selectedIds||[]),maximum);
    let expired=0,reconciled=0,cancelled=0,pending=0;
    for(const candidate of candidates) {
      if(deadlineAt!==undefined&&now()>=deadlineAt-1000){pending++;break;}
      let remote=null;
      if(candidate.payment_provider_id) {
        try {remote=await provider({deadlineAt}).getPayment(candidate.payment_provider_id,expected(candidate));}
        catch {pending++;}
        if(remote && remote.status!=='PENDING') {
          await apply(remote);reconciled++;
          const current=await db.prepare('SELECT * FROM orders WHERE id=?').get(candidate.id);
          if(current.status!=='PENDING' && !(current.status==='CANCELLED'&&current.payment_status==='EXPIRED')) continue;
        }
      }
      await db.transaction(async()=>{
        const row=await db.prepare('SELECT * FROM orders WHERE id=?'+db.lockSuffix).get(candidate.id);
        const payment=await db.prepare('SELECT * FROM payments WHERE order_id=?'+db.lockSuffix).get(candidate.id);
        if(!row||!payment||row.status!=='PENDING'||row.payment_status!=='PENDING')return;
        assertAttemptEnvironment(payment);
        const payload=parse(payment.payload_json),deadline=Math.min(Date.parse(payload.expiresAt),Date.parse(row.created_at)+RESERVATION_MS);
        if(now()<deadline)return;
        payload.localExpired=true;payload.expiredAt=new Date(now()).toISOString();payload.expiryCancelState=row.payment_provider_id?'PENDING':payload.creationState==='READY'?'DONE':'AWAITING_PROVIDER_ID';
        await db.prepare("UPDATE inventory_reservations SET status='RELEASED' WHERE order_id=? AND status='ACTIVE'").run(row.id);
        await db.prepare("UPDATE orders SET status='CANCELLED',payment_status='EXPIRED',updated_at=? WHERE id=?").run(stamp(),row.id);
        await db.prepare("UPDATE payments SET status='EXPIRED',payload_json=?,updated_at=? WHERE id=?").run(JSON.stringify(payload),stamp(),payment.id);
        await db.prepare('INSERT INTO payment_events VALUES(?,?,?,?,?,?) ON CONFLICT(event_key) DO NOTHING').run(uid(),payment.id,'local-expiry:'+row.id,'EXPIRED',JSON.stringify({deadline:payload.expiresAt}),stamp());
        await history(row.id,'EXPIRED','Prazo de 15 minutos encerrado. Pedido cancelado e reserva de estoque liberada.',null);
        await mail(await db.prepare('SELECT * FROM orders WHERE id=?').get(row.id),'order-cancelled','order:'+row.id+':expired');expired++;
      });
      const row=await db.prepare('SELECT * FROM orders WHERE id=?').get(candidate.id);
      if(row.status!=='CANCELLED'||row.payment_status!=='EXPIRED'||!row.payment_provider_id)continue;
      if(deadlineAt!==undefined&&now()>=deadlineAt-1000){pending++;continue;}
      try {
        const result=remote&&remote.status!=='PENDING'?remote:await provider({deadlineAt}).cancelOrder(row.payment_provider_id,expected(row));
        await apply(result);
        await db.transaction(async()=>{
          const payment=await db.prepare('SELECT * FROM payments WHERE order_id=?'+db.lockSuffix).get(row.id),payload=parse(payment.payload_json);
          payload.expiryCancelState=result.status==='PENDING'?'PENDING':'DONE';
          await db.prepare('UPDATE payments SET payload_json=?,updated_at=? WHERE id=?').run(JSON.stringify(payload),stamp(),payment.id);
        });
        if(result.status!=='PENDING')cancelled++;else pending++;
      } catch {
        pending++;
        // Give the next overdue order a turn even when one provider resource
        // repeatedly fails. This changes no financial state or reservation.
        await db.prepare("UPDATE orders SET updated_at=? WHERE id=? AND status='CANCELLED' AND payment_status='EXPIRED'").run(stamp(),row.id);
      }
    }
    return {expired,reconciled,cancelled,pending};
  }
  return { preparePayment, createPayment, reconcile, webhook, expireDue };
}

module.exports = { createMercadoPagoService };
