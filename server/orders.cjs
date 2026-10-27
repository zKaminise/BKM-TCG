const crypto = require('node:crypto');
const uid = () => crypto.randomUUID();
const stamp = () => new Date().toISOString();
const outcomes = new Set(['approved','pending','rejected','cancelled','expired']);
function canonical(value) { return Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])])) : value; }
const digest = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function createOrders({db,quote,env,audit,ApiError,enqueueEmail,paymentProvider,now=()=>Date.now()}) {
  const demo = env.BKM_ENVIRONMENT === 'demo' && env.PAYMENT_PROVIDER === 'mock';
  const {paymentReadiness,RESERVATION_MS}=require('./payments.cjs');
  const fail = (status,code,message) => { throw new ApiError(status,code,message); };
  function realPaymentInput(payment,{allowDeferredCard=false}={}) {
    if(!payment || payment.provider!=='mercadopago' || !['pix','card'].includes(payment.method)) fail(422,'PAYMENT_METHOD','Escolha um meio de pagamento disponível.');
    const payer=payment.payer || {},email=typeof payer.email==='string'?payer.email.trim().toLowerCase():'';
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>254) fail(422,'PAYMENT_PAYER_INVALID','Informe um e-mail válido para o pagamento.');
    if(env.MERCADO_PAGO_ENVIRONMENT==='sandbox' && !/@testuser\.com$/i.test(email)) fail(422,'PAYMENT_TEST_ACCOUNT_REQUIRED','O sandbox requer um comprador de teste do Mercado Pago.');
    const input={method:payment.method,payer:{email}};
    for(const key of ['firstName','lastName']) if(payer[key]!==undefined) {
      if(typeof payer[key]!=='string' || !payer[key].trim() || payer[key].length>120 || /[\u0000-\u001f\u007f]/.test(payer[key])) fail(422,'PAYMENT_PAYER_INVALID','Nome do pagador inválido.');
      input.payer[key]=payer[key].trim();
    }
    if(payer.identification) {
      const identification=payer.identification;
      if(!['CPF','CNPJ'].includes(identification.type) || typeof identification.number!=='string' || !(identification.type==='CPF'?/^\d{11}$/:/^\d{14}$/).test(identification.number)) fail(422,'PAYMENT_PAYER_INVALID','Documento do pagador inválido.');
      input.payer.identification={type:identification.type,number:identification.number};
    }
    if(payment.method==='card') {
      const card=payment.card || {};
      if(Object.keys(card).some(key=>!['token','paymentMethodId','type','installments'].includes(key))) fail(422,'PAYMENT_CARD_INVALID','Envie apenas o token de cartão gerado pelo Mercado Pago.');
      if(allowDeferredCard && Object.keys(card).length===0) return {...input,deferred:true};
      if(!/^[a-zA-Z0-9_-]{8,256}$/.test(card.token || '') || !/^[a-zA-Z0-9_-]{2,40}$/.test(card.paymentMethodId || '') || !['credit_card','debit_card'].includes(card.type) || !Number.isInteger(card.installments) || card.installments<1 || card.installments>12) fail(422,'PAYMENT_CARD_INVALID','Token, bandeira ou parcelas do cartão inválidos.');
      if(card.type==='debit_card' && card.installments!==1) fail(422,'PAYMENT_DEBIT_INSTALLMENTS','Cartão de débito permite somente pagamento à vista.');
      input.card={token:card.token,paymentMethodId:card.paymentMethodId,type:card.type,installments:card.installments};
    }
    return input;
  }
  function requireRealPayment() {
    const readiness=paymentReadiness(env);
    if(!readiness.enabled || readiness.provider!=='mercadopago' || !['staging','production'].includes(env.BKM_ENVIRONMENT)) fail(503,'PAYMENT_UNAVAILABLE','Pedidos comerciais e cobranças reais estão desativados.');
    return readiness;
  }
  async function serializeSnapshot(row) {
    const items = await db.prepare('SELECT * FROM order_items WHERE order_id=? ORDER BY id').all(row.id);
    const history = await db.prepare('SELECT * FROM order_history WHERE order_id=? ORDER BY created_at,id').all(row.id);
    const payment = await db.prepare('SELECT * FROM payments WHERE order_id=?').get(row.id);
    const payload=payment ? JSON.parse(payment.payload_json) : null,remote=payload?.providerPayment;
    const paymentEnvironment=payment?.environment==='demo'?'demo':remote?.sandbox?'sandbox':['sandbox','production'].includes(payload?.gatewayEnvironment)?payload.gatewayEnvironment:env.MERCADO_PAGO_ENVIRONMENT || 'production';
    const address=JSON.parse(row.address_json),expiresAt=payload?.expiresAt || new Date(Date.parse(row.created_at)+RESERVATION_MS).toISOString();
    const canResume=row.status==='PENDING'&&row.payment_status==='PENDING'&&Date.parse(expiresAt)>now();
    return { id:row.id,number:row.number || row.id,status:row.status,paymentStatus:row.payment_status,
      shippingStatus:row.shipping_status,currency:row.currency,environment:row.environment,demo:row.environment==='demo',
      subtotalCents:row.subtotal_cents,discountCents:row.discount_cents,shippingCents:row.shipping_cents,totalCents:row.total_cents,
      createdAt:row.created_at,updatedAt:row.updated_at,address,deliveryMode:address.deliveryMode || 'delivery',shipping:address.shipping || {deliveryMode:address.deliveryMode || 'delivery'},contact:JSON.parse(row.contact_json || '{}'),tracking:JSON.parse(row.tracking_json || '{}'),
      expiresAt,paymentExpiresAt:expiresAt,reservationExpiresAt:expiresAt,
      payment:payment ? {id:payment.id,providerId:row.payment_provider_id || null,provider:payment.provider,status:payment.status,demo:payment.environment==='demo',sandbox:paymentEnvironment==='sandbox',environment:paymentEnvironment,expiresAt,canResume,method:payload.method || (remote?.pix?'pix':null),creationState:payload.creationState || null,installments:remote?.installments || null,...(payment.provider==='mercadopago' && remote?.pix?.copyPaste ? {pix:{copyPaste:remote.pix.copyPaste}} : {})} : null,
      items:items.map(item => { const variant=JSON.parse(item.variant_json);return {id:item.id,variantId:item.variant_id,name:item.name,sku:item.sku,quantity:item.quantity,unitPriceCents:item.unit_price_cents,priceCents:item.unit_price_cents,totalCents:item.total_cents,variant,image:variant.image || null}; }),
      history:history.map(item => ({id:item.id,type:item.type,status:item.status,message:item.message,createdAt:item.created_at})) };
  }
  async function history(orderId,type,status,message,actor) { const id=uid();await db.prepare('INSERT INTO order_history VALUES(?,?,?,?,?,?,?)').run(id,orderId,type,status,message,actor || null,stamp());return id; }
  const {createMercadoPagoService}=require('./payment-service.cjs');
  const mercadoPago=createMercadoPagoService({db,env,ApiError,serializeOrder:serializeSnapshot,recordHistory:history,audit,enqueueEmail,provider:paymentProvider,now});
  async function mail(row,template,key) {
    if(!enqueueEmail) return;
    const order=await serializeSnapshot(row),contact=JSON.parse(row.contact_json);
    await enqueueEmail({key,template,to:contact.email,data:{...order,name:contact.name,customerName:contact.name,orderNumber:order.number,orderId:order.id,orderUrl:(env.BKM_PUBLIC_URL || env.PUBLIC_URL || '')+'/conta/pedidos/'+order.id,trackingCode:order.tracking.code,trackingUrl:order.tracking.url,carrier:order.tracking.carrier,demo:row.environment==='demo'}});
  }
  async function applyPayment(row,outcome,key,actor) {
    const payment = await db.prepare('SELECT * FROM payments WHERE order_id=?'+db.lockSuffix).get(row.id);
    const previous = await db.prepare('SELECT * FROM payment_events WHERE event_key=?').get(key);
    if(previous) {
      if(previous.payment_id!==payment.id || previous.status!==outcome.toUpperCase()) fail(409,'IDEMPOTENCY_CONFLICT','Este identificador já foi utilizado em outro evento.');
      return serialize(await db.prepare('SELECT * FROM orders WHERE id=?').get(row.id));
    }
    if(payment.status!=='PENDING') fail(409,'PAYMENT_FINAL','A simulação já possui um estado final. Crie outro pedido para testar um resultado diferente.');
    let payload = JSON.parse(payment.payload_json);
    if(Date.parse(payload.expiresAt)<=now()) outcome='expired';
    const provider=require('./payments.cjs').createPaymentProvider({env});
    const event=await provider.simulatePayment({payment:payload,outcome,eventId:digest(key)});
    const status=event.status;
    if(!['APPROVED','PENDING','REJECTED','CANCELLED','EXPIRED'].includes(status)) fail(422,'PAYMENT_STATUS','Estado de pagamento inválido.');
    const reservations = await db.prepare("SELECT * FROM inventory_reservations WHERE order_id=? AND status='ACTIVE' ORDER BY variant_id").all(row.id);
    if(status==='APPROVED') {
      for(const item of reservations) {
        const variant=await db.prepare('SELECT * FROM variants WHERE id=?'+db.lockSuffix).get(item.variant_id);
        if(variant.stock<item.quantity) fail(409,'STOCK_CHANGED','O estoque reservado foi alterado. Entre em contato com a loja.');
        const result=await db.prepare('UPDATE variants SET stock=stock-? WHERE id=? AND stock>=?').run(item.quantity,item.variant_id,item.quantity);
        if(result.changes!==1) fail(409,'STOCK_CHANGED','Estoque insuficiente.');
        await db.prepare('INSERT INTO stock_movements VALUES(?,?,?,?,?,?,?)').run(uid(),item.variant_id,actor,-item.quantity,variant.stock-item.quantity,'Pedido de demonstração aprovado '+row.number,stamp());
      }
      await db.prepare("UPDATE inventory_reservations SET status='COMMITTED' WHERE order_id=? AND status='ACTIVE'").run(row.id);
      if(row.coupon_id) {
        const update=await db.prepare('UPDATE coupons SET used_count=used_count+1 WHERE id=? AND (max_uses IS NULL OR used_count<max_uses)').run(row.coupon_id);
        if(update.changes!==1) fail(409,'COUPON_EXHAUSTED','O limite deste cupom foi atingido.');
      }
    } else if(status!=='PENDING') await db.prepare("UPDATE inventory_reservations SET status='RELEASED' WHERE order_id=? AND status='ACTIVE'").run(row.id);
    const orderStatus=status==='APPROVED' ? 'CONFIRMED' : status==='PENDING' ? 'PENDING' : 'CANCELLED';
    await db.prepare('UPDATE payments SET status=?,payload_json=?,updated_at=? WHERE id=?').run(status,JSON.stringify(event),stamp(),payment.id);
    await db.prepare('INSERT INTO payment_events VALUES(?,?,?,?,?,?)').run(uid(),payment.id,key,status,JSON.stringify(event),stamp());
    const shippingStatus=status==='APPROVED'?'PROCESSING':row.shipping_status;
    await db.prepare('UPDATE orders SET status=?,payment_status=?,shipping_status=?,updated_at=? WHERE id=?').run(orderStatus,status,shippingStatus,stamp(),row.id);
    if(status==='APPROVED') await db.prepare("UPDATE shipments SET status='PROCESSING',updated_at=? WHERE order_id=?").run(stamp(),row.id);
    await history(row.id,'PAYMENT',status,'Simulação de pagamento: '+status+'. Nenhuma cobrança real.',actor);
    const updated=await db.prepare('SELECT * FROM orders WHERE id=?').get(row.id);
    if(status!=='PENDING') await mail(updated,status==='APPROVED'?'payment-approved':'payment-rejected','payment:'+row.id+':'+status);
    if(status==='APPROVED') {
      await mail(updated,'order-preparing','order:'+row.id+':preparing');
      if(enqueueEmail) for(const admin of await db.prepare("SELECT id,email,name,profile_json FROM users WHERE role='ADMIN' ORDER BY id").all()) {
        const order=await serializeSnapshot(updated);
        const configured=JSON.parse(admin.profile_json || '{}').notificationEmail;
        const to=typeof configured==='string'&&configured.length<=254&&/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(configured.trim())?configured.trim().toLowerCase():admin.email;
        await enqueueEmail({key:'order:'+row.id+':admin-paid:'+admin.id,template:'admin-order-paid',to,data:{...order,name:admin.name,customerName:order.contact.name,orderNumber:row.number,orderId:row.id,orderUrl:(env.BKM_PUBLIC_URL || env.PUBLIC_URL || '')+'/admin/pedidos/'+row.id,demo:true}});
      }
    }
    return serializeSnapshot(updated);
  }
  async function create(data,user) {
    await expireDue();
    if(!demo) requireRealPayment();
    const outcome=data.payment?.outcome || 'pending';
    if(demo && (data.payment?.provider!=='mock' || !outcomes.has(outcome))) fail(422,'DEMO_PAYMENT','Escolha um resultado de pagamento de demonstração.');
    const realInput=demo?null:realPaymentInput(data.payment,{allowDeferredCard:true});
    if(typeof data.idempotencyKey!=='string' || !/^[A-Za-z0-9_-]{16,120}$/.test(data.idempotencyKey)) fail(422,'IDEMPOTENCY_KEY','Atualize a página para gerar um identificador de pedido válido.');
    const contact={name:String(data.contact?.name || user.name).trim(),email:String(data.contact?.email || user.email).trim().toLowerCase(),phone:String(data.contact?.phone || data.address?.phone || '').trim()};
    const address={};
    for(const field of ['name','phone','street','number','complement','district','city','state']) address[field]=String(data.address?.[field] || '').trim();
    address.zip=String(data.address?.zip || data.address?.postalCode || data.cep || '').replace(/\D/g,'');
    if(!contact.name || contact.name.length>120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email) || contact.email.length>254 || contact.phone.length>30) fail(422,'CONTACT','Revise nome, e-mail e telefone.');
    const deliveryMode=data.deliveryMode || data.shipping?.deliveryMode || 'delivery';
    if(!['delivery','pickup','local'].includes(deliveryMode)) fail(422,'DELIVERY_MODE','Escolha uma modalidade de entrega válida.');
    if((deliveryMode!=='pickup'&&(address.zip.length!==8 || !address.street || !address.number || !address.district || !address.city || !/^[A-Z]{2}$/.test(address.state))) || Object.values(address).some(value=>value.length>200)) fail(422,'ADDRESS','Preencha o endereço completo com CEP e UF válidos.');
    const key=digest([user.id,data.idempotencyKey]),hash=digest({items:data.items,coupon:data.coupon||'',contact,address,deliveryMode,shippingMethod:data.shippingMethod || '',payment:demo?data.payment:realInput});
    const result=await db.transaction(async()=>{
      // Serializes retries of the same request before checking its unique key.
      if(db.engine==='postgres') await db.prepare('SELECT pg_advisory_xact_lock(hashtext(?))').get(key);
      const prior=await db.prepare('SELECT * FROM orders WHERE idempotency_key=?').get(key);
      if(prior) { if(prior.user_id!==user.id || prior.request_hash!==hash) fail(409,'IDEMPOTENCY_CONFLICT','Este pedido já foi enviado com dados diferentes.');return {order:await serialize(prior)}; }
      const q=await quote({...data,deliveryMode,address,cep:address.zip},true);
      if(!q.shipping.available || q.totalCents==null) fail(422,'SHIPPING_UNAVAILABLE',q.shipping.reason || 'Revise a modalidade de frete.');
      if(!demo && q.shipping.demo) fail(409,'DEMO_DATABASE','O banco de demonstração não pode receber pedidos comerciais. Use um banco dedicado e configure o frete.');
      const id=uid(),number=(demo?'DEMO-':env.BKM_ENVIRONMENT==='staging'?'TESTE-':'BKM-')+new Date().toISOString().slice(0,10).replace(/-/g,'')+'-'+crypto.randomBytes(5).toString('hex').toUpperCase();
      const addressSnapshot={...address,deliveryMode:q.shipping.deliveryMode || deliveryMode,shipping:q.shipping};
      const created=new Date(now()).toISOString(),coupon=q.coupon ? await db.prepare('SELECT id FROM coupons WHERE code=?').get(q.coupon) : null;
      await db.prepare("INSERT INTO orders(id,user_id,status,payment_status,shipping_status,currency,subtotal_cents,discount_cents,shipping_cents,total_cents,coupon_id,address_json,payment_provider_id,idempotency_key,created_at,updated_at,number,environment,contact_json,request_hash) VALUES(?,?,'PENDING','PENDING','UNFULFILLED','BRL',?,?,?,?,?,?,NULL,?,?,?,?,?,?,?)").run(id,user.id,q.subtotalCents,q.discountCents,q.shippingCents,q.totalCents,coupon?.id || null,JSON.stringify(addressSnapshot),key,created,created,number,demo?'demo':'production',JSON.stringify(contact),hash);
      let payment;
      if(demo) {
        const provider=require('./payments.cjs').createPaymentProvider({env});
        payment=await provider.createPayment({orderId:id,amountCents:q.totalCents,currency:'BRL',outcome:'pending',idempotencyKey:key});
        await db.prepare('INSERT INTO payments VALUES(?,?,?,?,?,?,?,?,?,?)').run(payment.id,id,'mock','PENDING',q.totalCents,'BRL','demo',JSON.stringify(payment),created,created);
        await db.prepare('UPDATE orders SET payment_provider_id=? WHERE id=?').run(payment.id,id);
      }
      for(const item of q.items) {
        const snapshot={language:item.language,condition:item.condition,finish:item.finish,image:item.image,productId:item.productId,slug:item.slug};
        await db.prepare('INSERT INTO order_items VALUES(?,?,?,?,?,?,?,?,?)').run(uid(),id,item.variantId,item.name,item.sku,JSON.stringify(snapshot),item.quantity,item.unitPriceCents,item.totalCents);
        await db.prepare("INSERT INTO inventory_reservations VALUES(?,?,?,?,'ACTIVE',?,?)").run(uid(),item.variantId,id,item.quantity,Date.parse(payment?.expiresAt)||Date.parse(created)+RESERVATION_MS,created);
      }
      await db.prepare('INSERT INTO addresses VALUES(?,?,?,?)').run(uid(),user.id,JSON.stringify(address),created);
      await db.prepare("INSERT INTO shipments VALUES(?,?,?,'UNFULFILLED','','',?,?)").run(uid(),id,demo?'demo':'manual',created,created);
      await history(id,'ORDER','PENDING',demo?'Pedido de demonstração criado. Estoque reservado por 15 minutos.':'Pedido realizado. Estoque reservado por 15 minutos para concluir o pagamento.',user.id);
      await db.prepare("DELETE FROM account_lists WHERE user_id=? AND kind='cart'").run(user.id);
      const row=await db.prepare('SELECT * FROM orders WHERE id=?').get(id);
      if(!demo) await mercadoPago.preparePayment(row,realInput);
      await mail(row,'order-confirmation','order:'+id);
      await mail(row,'payment-pending','order:'+id+':pending');
      if(!demo && realInput.deferred) return {order:await serializeSnapshot(row)};
      if(!demo) return {row};
      return {order:await (outcome==='pending' ? serialize(row) : applyPayment(row,outcome,'create:'+id,user.id))};
    });
    if(result.order) return result.order;
    // Stock and order snapshots are committed before an external payment call.
    try { return await mercadoPago.createPayment(result.row,realInput); }
    catch(error) { error.fields={...error.fields,orderId:result.row.id};throw error; }
  }
  async function ownedOrder(id,user,admin=false) {
    const row=await db.prepare('SELECT * FROM orders WHERE id=?').get(id);
    if(!row || (!admin && row.user_id!==user.id)) fail(404,'ORDER_NOT_FOUND','Pedido não encontrado.');
    return row;
  }
  async function payment(id,data,user) {
    requireRealPayment();
    await expireDue({orderId:id});
    const row=await ownedOrder(id,user);
    return mercadoPago.createPayment(row,realPaymentInput(data.payment || data));
  }
  async function reconcile(id,user,admin=false) {
    requireRealPayment();
    const row=await ownedOrder(id,user,admin);
    return mercadoPago.reconcile(row.id,user.id);
  }
  async function simulate(id,data,user,admin=false) {
    if(!demo) fail(403,'DEMO_ONLY','Simulações indisponíveis neste ambiente.');
    const outcome=data.outcome==='refused'?'rejected':data.outcome;
    if(!outcomes.has(outcome)) fail(422,'PAYMENT_STATUS','Escolha um resultado válido.');
    const key=String(data.idempotencyKey || uid());
    if(!/^[A-Za-z0-9:_-]{8,160}$/.test(key)) fail(422,'IDEMPOTENCY_KEY','Identificador de evento inválido.');
    return db.transaction(async()=>{
      const row=await db.prepare('SELECT * FROM orders WHERE id=?'+db.lockSuffix).get(id);
      if(!row || (!admin && row.user_id!==user.id)) fail(404,'ORDER_NOT_FOUND','Pedido não encontrado.');
      if(row.environment!=='demo') fail(403,'DEMO_ONLY','A simulação exige um pedido demonstrativo.');
      return applyPayment(row,outcome,'simulate:'+id+':'+key,user.id);
    });
  }
  async function shipping(id,data,user) {
    const statuses=['PROCESSING','READY_TO_SHIP','SHIPPED','DELIVERED'];
    if(!statuses.includes(data.status)) fail(422,'SHIPPING_STATUS','Status de envio inválido.');
    const code=String(data.trackingCode || '').trim(),url=String(data.trackingUrl || '').trim(),carrier=String(data.carrier || '').trim();
    let trackingUrl;try{trackingUrl=url?new URL(url):null;}catch{fail(422,'TRACKING','Use um endereço HTTPS de rastreamento válido.');}
    if(code.length>100 || /[\u0000-\u001f\u007f]/.test(code) || carrier.length>100 || url.length>2000 || trackingUrl&&(trackingUrl.protocol!=='https:'||trackingUrl.username||trackingUrl.password)) fail(422,'TRACKING','Use um código válido e um endereço HTTPS de rastreamento.');
    if(data.status==='SHIPPED' && !code) fail(422,'TRACKING_REQUIRED','Informe o código de rastreamento antes de marcar o pedido como enviado.');
    return db.transaction(async()=>{
      const row=await db.prepare('SELECT * FROM orders WHERE id=?'+db.lockSuffix).get(id);
      if(!row) fail(404,'ORDER_NOT_FOUND','Pedido não encontrado.');
      if(row.status!=='CONFIRMED' || !['APPROVED','PAID'].includes(row.payment_status)) fail(409,'UNPAID_ORDER','O pedido precisa estar confirmado e pago antes de alterar o envio.');
      const rank={UNFULFILLED:0,PROCESSING:1,READY_TO_SHIP:2,SHIPPED:3,DELIVERED:4};
      if(rank[data.status]<rank[row.shipping_status]) fail(409,'SHIPPING_TRANSITION','O envio não pode voltar para uma etapa anterior.');
      if(data.status==='SHIPPED' && !['READY_TO_SHIP','SHIPPED'].includes(row.shipping_status)) fail(409,'SHIPPING_TRANSITION','Marque o pedido como separado para envio antes de registrar a postagem.');
      const deliveryMode=JSON.parse(row.address_json).deliveryMode || 'delivery';
      const deliveredFrom=['pickup','local'].includes(deliveryMode)?['READY_TO_SHIP','SHIPPED','DELIVERED']:['SHIPPED','DELIVERED'];
      if(data.status==='DELIVERED' && !deliveredFrom.includes(row.shipping_status)) fail(409,'SHIPPING_TRANSITION',['pickup','local'].includes(deliveryMode)?'Separe o pedido antes de confirmar a retirada ou entrega local.':'Registre o envio antes de confirmar a entrega.');
      const currentTracking=JSON.parse(row.tracking_json || '{}');
      const nextTracking={code:code || currentTracking.code || '',url:url || currentTracking.url || '',carrier:carrier || currentTracking.carrier || ''};
      if(row.shipping_status===data.status && ['code','url','carrier'].every(key=>(currentTracking[key] || '')===nextTracking[key])) return serializeSnapshot(row);
      await db.prepare('UPDATE orders SET shipping_status=?,tracking_json=?,updated_at=? WHERE id=?').run(data.status,JSON.stringify(nextTracking),stamp(),id);
      await db.prepare('UPDATE shipments SET status=?,tracking_code=?,tracking_url=?,updated_at=? WHERE order_id=?').run(data.status,nextTracking.code,nextTracking.url,stamp(),id);
      const eventId=await history(id,'SHIPPING',data.status,(row.environment==='demo'?'Envio de demonstração':'Envio')+' atualizado pelo administrador.',user.id);
      await audit(user.id,'ORDER_SHIPPING_UPDATED',id,{status:data.status});
      const updated=await db.prepare('SELECT * FROM orders WHERE id=?').get(id);
      const template={PROCESSING:'order-preparing',READY_TO_SHIP:'order-ready-to-ship',SHIPPED:'order-shipped',DELIVERED:'order-delivered'}[data.status];
      if(row.shipping_status!==data.status) await mail(updated,template,data.status==='PROCESSING'?'order:'+id+':preparing':'shipping:'+id+':'+data.status);
      else await mail(updated,'tracking-update','shipping:'+id+':tracking:'+digest(nextTracking));
      return serializeSnapshot(updated);
    });
  }
  async function expireDue(options={}) {
    const result=await mercadoPago.expireDue(options);
    if(demo) await db.transaction(async()=>{
      const maximum=Math.max(1,Math.min(200,Number.isInteger(options.limit)?options.limit:100));
      const selectedIds=Array.isArray(options.orderIds)?[...new Set(options.orderIds.filter(id=>typeof id==='string'))].slice(0,200):null;
      if(selectedIds&&!selectedIds.length)return;
      const rows=await db.prepare("SELECT DISTINCT o.* FROM orders o JOIN inventory_reservations r ON r.order_id=o.id WHERE o.environment='demo' AND o.status='PENDING' AND o.payment_status='PENDING' AND r.status='ACTIVE' AND r.expires_at<=?"+(options.orderId?' AND o.id=?':'')+(selectedIds?' AND o.id IN('+selectedIds.map(()=>'?').join(',')+')':'')+' ORDER BY o.id LIMIT ?').all(now(),...(options.orderId?[options.orderId]:[]),...(selectedIds||[]),maximum);
      for(const entry of rows){if(options.deadlineAt!==undefined&&now()>=options.deadlineAt-1000){result.pending++;break;}const row=await db.prepare('SELECT * FROM orders WHERE id=?'+db.lockSuffix).get(entry.id);if(row.status!=='PENDING')continue;await applyPayment(row,'expired','local-expiry:'+row.id,null);result.expired++;}
    });
    return result;
  }
  async function serialize(row) {
    await expireDue({orderId:row.id});
    return serializeSnapshot(await db.prepare('SELECT * FROM orders WHERE id=?').get(row.id));
  }
  async function serializeMany(rows){
    if(!rows.length)return [];
    const ids=rows.map(row=>row.id);
    await expireDue({orderIds:ids,limit:ids.length});
    const fresh=await db.prepare('SELECT * FROM orders WHERE id IN('+ids.map(()=>'?').join(',')+')').all(...ids);
    const byId=new Map(fresh.map(row=>[row.id,row]));
    return Promise.all(rows.map(row=>serializeSnapshot(byId.get(row.id)||row)));
  }
  return {create,simulate,serialize,serializeMany,shipping,payment,reconcile,expireDue,webhook:mercadoPago.webhook};
}
module.exports={createOrders};
