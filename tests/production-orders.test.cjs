'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {openStore}=require('../server/store.cjs');
const {createOrders}=require('../server/orders.cjs');
const {createEmailStore}=require('../server/email-store.cjs');
const {MercadoPagoPaymentProvider,RESERVATION_MS}=require('../server/payments.cjs');
const {renderEmail}=require('../server/email.cjs');
const uid=()=>crypto.randomUUID();
const env={BKM_ENVIRONMENT:'staging',PAYMENT_PROVIDER:'mercadopago',MERCADO_PAGO_ENABLED:'true',MERCADO_PAGO_ENVIRONMENT:'sandbox',MERCADO_PAGO_ACCESS_TOKEN:'fixture-only-never-real',MERCADO_PAGO_PUBLIC_KEY:'fixture-only-public',MERCADO_PAGO_WEBHOOK_SECRET:'fixture-only-secret',MERCADO_PAGO_SELLER_ID:'123456',EMAIL_PROVIDER:'development',BKM_PUBLIC_URL:'https://bkm.example.test'};
class ApiError extends Error{constructor(status,code,message,fields){super(message);Object.assign(this,{status,code,fields});}}
async function fixture(engine,t){
  const pg=engine==='postgres'?new PGlite():null;
  // A pool with one connection, as in serverless deployment. Concurrent callers
  // queue for the connection, while row locks/conditional updates remain real SQL.
  let lease=Promise.resolve();
  const query=async(sql,args)=>args?.length?pg.query(sql,args):(await pg.exec(sql)).at(-1);
  const pgClient=pg?{query,end:()=>pg.close(),async connect(){const previous=lease;let release;lease=new Promise(resolve=>{release=resolve;});await previous;return {query,release};}}:undefined;
  const db=openStore({dbPath:':memory:',pgClient,env:{}});await db.ready;t.after(()=>db.close());
  const f={db,now:Date.now(),posts:0,cancels:0,remotes:new Map(),failCancel:false,failEmail:false,ambiguousCreate:false,approveOnCreate:false};
  const stamp=()=>new Date(f.now).toISOString();
  const buyer={id:uid(),email:'buyer@testuser.com',name:'Comprador de teste'},other={id:uid(),email:'other@testuser.com',name:'Outro cliente'},admins=[{id:uid(),email:'admin-login@example.test',name:'Admin 1',profile:{notificationEmail:'operacional@example.test'}},{id:uid(),email:'admin-two@example.test',name:'Admin 2',profile:{}},{id:uid(),email:'admin-fallback@example.test',name:'Admin 3',profile:{notificationEmail:'invalid'}}];
  for(const user of [buyer,other,...admins])await db.prepare('INSERT INTO users(id,email,name,password_hash,role,profile_json,created_at) VALUES(?,?,?,?,?,?,?)').run(user.id,user.email,user.name,'no-real-password',admins.includes(user)?'ADMIN':'CUSTOMER',JSON.stringify(user.profile||{}),stamp());
  f.buyer=buyer;f.other=other;f.admins=admins;
  f.approve=(id,when=f.now)=>{const remote=f.remotes.get(id);Object.assign(remote,{status:'processed',status_detail:'accredited',last_updated_date:new Date(when).toISOString(),total_paid_amount:remote.total_amount});remote.transactions.payments[0]={...remote.transactions.payments[0],status:'processed',status_detail:'accredited',paid_amount:remote.total_amount};return remote;};
  const provider=new MercadoPagoPaymentProvider({env,now:()=>f.now,fetchImpl:async(url,options)=>{
    if(options.method==='POST'&&url.endsWith('/cancel')){f.cancels++;assert.ok(options.headers['X-Idempotency-Key']);assert.equal(options.body,undefined);if(f.failCancel)return new Response(JSON.stringify({error:'temporary'}),{status:503});const remote=[...f.remotes.values()].find(r=>r.id===url.split('/').at(-2));remote.status='canceled';remote.status_detail='canceled';remote.last_updated_date=stamp();return Response.json(remote);}
    if(options.method==='POST'){f.posts++;const body=JSON.parse(options.body);const remote={id:'ORD'+uid().replace(/-/g,'').toUpperCase(),external_reference:body.external_reference,user_id:env.MERCADO_PAGO_SELLER_ID,country_code:'BRA',currency_id:'BRL',live_mode:false,total_amount:body.total_amount,total_paid_amount:'0.00',status:'action_required',status_detail:'waiting_payment',last_updated_date:stamp(),transactions:{payments:[{amount:body.total_amount,paid_amount:'0.00',status:'created',status_detail:'created',payment_method:body.transactions.payments[0].payment_method}]}};f.remotes.set(body.external_reference,remote);if(f.approveOnCreate)f.approve(body.external_reference);if(f.ambiguousCreate)return new Response(JSON.stringify({error:'temporary'}),{status:503});return Response.json({id:remote.id});}
    const remote=[...f.remotes.values()].find(r=>r.id===url.split('/').pop());return remote?Response.json(remote):new Response(JSON.stringify({error:'not_found'}),{status:404});
  }});
  const emailStore=createEmailStore(db);
  async function quote(data,lock){const items=[];let subtotalCents=0;for(const item of [...data.items].sort((a,b)=>a.variantId.localeCompare(b.variantId))){const row=await db.prepare('SELECT * FROM variants WHERE id=?'+(lock?db.lockSuffix:'')).get(item.variantId);const reserved=Number((await db.prepare("SELECT COALESCE(SUM(quantity),0) n FROM inventory_reservations WHERE variant_id=? AND status='ACTIVE' AND expires_at>?").get(item.variantId,f.now)).n);if(row.stock-reserved<item.quantity)throw new ApiError(409,'INSUFFICIENT_STOCK','Sem estoque disponível.');items.push({variantId:row.id,productId:row.product_id,name:'Carta de teste',sku:'TEST',slug:'card-test',quantity:item.quantity,unitPriceCents:row.price_cents,totalCents:row.price_cents*item.quantity,language:row.language,condition:row.condition,finish:row.finish,image:null});subtotalCents+=row.price_cents*item.quantity;}return {items,subtotalCents,discountCents:0,shippingCents:0,totalCents:subtotalCents,coupon:null,shipping:{available:true,demo:false,deliveryMode:data.deliveryMode||'delivery',destination:{city:'Uberlândia',state:'MG'},free:true}};}
  f.orders=createOrders({db,quote,env,ApiError,now:()=>f.now,audit:async()=>{},paymentProvider:provider,enqueueEmail:async message=>{if(f.failEmail)throw new Error('isolated outbox failure');return emailStore.enqueue(message);}});
  f.product=async(stock=1)=>{const productId=uid(),variantId=uid();await db.prepare("INSERT INTO products(id,slug,kind,name,description,sku,tcg,set_id,set_name,images_json,search_text,published,created_at,updated_at) VALUES(?,?,'SINGLE','Carta de teste','Registro apenas de teste',?,'pokemon','unit','Unit','[]','test',1,?,?)").run(productId,'test-'+productId,'TEST-'+productId,stamp(),stamp());await db.prepare("INSERT INTO variants(id,product_id,language,condition,finish,price_cents,stock) VALUES(?,?,'pt','NM','NORMAL',10000,?)").run(variantId,productId,stock);return {productId,variantId};};
  f.payload=(variantId,method='card',deliveryMode='delivery')=>({items:[{variantId,quantity:1}],deliveryMode,contact:{name:buyer.name,email:buyer.email,phone:'11999999999'},address:deliveryMode==='pickup'?{}:{zip:'38400000',street:'Rua de teste',number:'1',district:'Centro',city:'Uberlândia',state:'MG'},payment:{provider:'mercadopago',method,payer:{email:buyer.email}},idempotencyKey:uid()});
  f.card={payment:{provider:'mercadopago',method:'card',payer:{email:buyer.email},card:{token:'isolated-token-not-real',paymentMethodId:'master',type:'credit_card',installments:3}}};
  f.messages=async orderId=>(await db.prepare('SELECT payload_json FROM email_outbox').all()).map(row=>JSON.parse(row.payload_json)).filter(m=>m.data.orderId===orderId);
  f.stock=async variantId=>(await db.prepare('SELECT stock FROM variants WHERE id=?').get(variantId)).stock;
  f.sign=remote=>{const requestId=uid(),ts=String(f.now);return {requestId,dataId:remote.id,signature:`ts=${ts},v1=${crypto.createHmac('sha256',env.MERCADO_PAGO_WEBHOOK_SECRET).update(`id:${remote.id.toLowerCase()};request-id:${requestId};ts:${ts};`).digest('hex')}`};};
  return f;
}

for(const engine of ['sqlite','postgres'])test('fluxo comercial de 15 minutos, estoque e notificações: '+engine,async t=>{
  const f=await fixture(engine,t),db=f.db;
  await t.test('confirmar cartão reserva antes de tokenizar; concorrência pela última unidade aceita um pedido',async()=>{
    const p=await f.product(),a=f.payload(p.variantId),b=f.payload(p.variantId);
    const before=f.posts,results=await Promise.allSettled([f.orders.create(a,f.buyer),f.orders.create(b,f.other)]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.code==='INSUFFICIENT_STOCK').length,1);assert.equal(f.posts,before);
    const order=results.find(r=>r.status==='fulfilled').value;assert.equal(order.status,'PENDING');assert.equal(order.payment.method,'card');assert.equal(order.payment.canResume,true);assert.equal(Date.parse(order.expiresAt)-Date.parse(order.createdAt),RESERVATION_MS);assert.equal(await f.stock(p.variantId),1);
    const messages=await f.messages(order.id);assert.deepEqual(messages.map(m=>m.template).sort(),['order-confirmation','payment-pending']);assert.ok(messages.every(m=>m.to===f.buyer.email));
    const retry=await f.orders.create(a,f.buyer);assert.equal(retry.id,order.id);assert.equal((await f.messages(order.id)).length,2);
    const bad={...f.card,payment:{...f.card.payment,card:{...f.card.payment.card,type:'debit_card',installments:2}}};await assert.rejects(f.orders.payment(order.id,bad,f.buyer),error=>error.code==='PAYMENT_DEBIT_INSTALLMENTS');assert.equal(f.posts,before);
  });
  await t.test('pagamento aprovado: quatro e-mails ao cliente e um para cada admin com override operacional',async()=>{
    const p=await f.product(),order=await f.orders.create(f.payload(p.variantId),f.buyer);assert.equal(order.deliveryMode,'delivery');
    f.approveOnCreate=true;const paid=await f.orders.payment(order.id,f.card,f.buyer);f.approveOnCreate=false;
    assert.equal(paid.status,'CONFIRMED');assert.equal(paid.shippingStatus,'PROCESSING');assert.equal(paid.paymentStatus,'APPROVED');assert.equal(paid.payment.canResume,false);assert.equal(await f.stock(p.variantId),0);
    await f.orders.reconcile(order.id,f.buyer);await f.orders.webhook(f.sign(f.remotes.get(order.id)));
    const messages=await f.messages(order.id),customer=messages.filter(m=>m.to===f.buyer.email),admins=messages.filter(m=>m.template==='admin-order-paid');assert.deepEqual(customer.map(m=>m.template).sort(),['order-confirmation','order-preparing','payment-approved','payment-pending']);assert.equal(admins.length,3);assert.deepEqual(admins.map(m=>m.to).sort(),['admin-fallback@example.test','admin-two@example.test','operacional@example.test']);assert.ok(admins.every(m=>m.data.orderUrl.includes('/admin/pedidos/')));assert.ok(!JSON.stringify(paid).includes(f.card.payment.card.token));
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM stock_movements WHERE variant_id=?').get(p.variantId)).n,1);
    await f.orders.shipping(order.id,{status:'PROCESSING'},f.admins[0]);assert.equal((await f.messages(order.id)).length,messages.length);
    await assert.rejects(f.orders.shipping(order.id,{status:'SHIPPED',trackingCode:'AB123'},f.admins[0]),e=>e.code==='SHIPPING_TRANSITION');
    const ready=await f.orders.shipping(order.id,{status:'READY_TO_SHIP'},f.admins[0]);assert.equal(ready.shippingStatus,'READY_TO_SHIP');await f.orders.shipping(order.id,{status:'READY_TO_SHIP'},f.admins[0]);
    await assert.rejects(f.orders.shipping(order.id,{status:'SHIPPED'},f.admins[0]),e=>e.code==='TRACKING_REQUIRED');
    const shipped=await f.orders.shipping(order.id,{status:'SHIPPED',trackingCode:'AB123456789BR',trackingUrl:'https://tracking.example.test/AB123456789BR',carrier:'Transportadora teste'},f.admins[0]);assert.equal(shipped.tracking.code,'AB123456789BR');
    await f.orders.shipping(order.id,{status:'SHIPPED',trackingCode:'AB123456789BR',trackingUrl:'https://tracking.example.test/AB123456789BR',carrier:'Transportadora teste'},f.admins[0]);
    await assert.rejects(f.orders.shipping(order.id,{status:'PROCESSING'},f.admins[0]),e=>e.code==='SHIPPING_TRANSITION');
    const after=await f.messages(order.id);assert.equal(after.filter(m=>m.template==='order-ready-to-ship').length,1);assert.equal(after.filter(m=>m.template==='order-shipped').length,1);const rendered=renderEmail('order-shipped',after.find(m=>m.template==='order-shipped').data,{env});assert.ok(rendered.html.includes('https://tracking.example.test/AB123456789BR'));assert.ok(rendered.text.includes('AB123456789BR'));
  });
  await t.test('retirada e entrega local concluem após separação sem inventar rastreamento',async()=>{
    for(const mode of ['pickup','local']) {
      const p=await f.product(),order=await f.orders.create(f.payload(p.variantId,'card',mode),f.buyer);assert.equal(order.deliveryMode,mode);f.approveOnCreate=true;await f.orders.payment(order.id,f.card,f.buyer);f.approveOnCreate=false;
      await assert.rejects(f.orders.shipping(order.id,{status:'DELIVERED'},f.admins[0]),e=>e.code==='SHIPPING_TRANSITION');await f.orders.shipping(order.id,{status:'READY_TO_SHIP'},f.admins[0]);const delivered=await f.orders.shipping(order.id,{status:'DELIVERED'},f.admins[0]);assert.equal(delivered.shippingStatus,'DELIVERED');assert.equal(delivered.tracking.code,'');const ready=(await f.messages(order.id)).find(m=>m.template==='order-ready-to-ship');const rendered=renderEmail(ready.template,ready.data,{env});assert.ok(rendered.subject.includes(mode==='pickup'?'retirada':'entrega local'));
    }
  });
  await t.test('15 minutos expiram na leitura, cancelam sem cobrança e liberam a unidade',async()=>{
    const p=await f.product(),order=await f.orders.create(f.payload(p.variantId),f.buyer),posts=f.posts;
    f.now+=RESERVATION_MS;const read=await f.orders.serialize(await db.prepare('SELECT * FROM orders WHERE id=?').get(order.id));assert.equal(read.status,'CANCELLED');assert.equal(read.paymentStatus,'EXPIRED');assert.equal(read.payment.canResume,false);assert.equal(f.posts,posts);assert.equal(await f.stock(p.variantId),1);
    await f.orders.expireDue({orderId:order.id});assert.equal((await f.messages(order.id)).filter(m=>m.template==='order-cancelled').length,1);await assert.rejects(f.orders.payment(order.id,f.card,f.buyer),e=>['PAYMENT_EXPIRED','PAYMENT_ORDER_CLOSED'].includes(e.code));assert.equal(f.posts,posts);
    const next=await f.orders.create(f.payload(p.variantId),f.other);assert.equal(next.status,'PENDING');
  });
  await t.test('cancelamento remoto é retomado; aprovação tardia nunca consome reserva de outro cliente',async()=>{
    const p=await f.product(),order=await f.orders.create(f.payload(p.variantId,'pix'),f.buyer);f.failCancel=true;f.now+=RESERVATION_MS+1;
    const expired=await f.orders.expireDue({orderId:order.id});assert.equal(expired.expired,1);assert.ok(expired.pending>=1);assert.equal((await db.prepare('SELECT status FROM orders WHERE id=?').get(order.id)).status,'CANCELLED');
    const next=await f.orders.create(f.payload(p.variantId),f.other);assert.equal(next.status,'PENDING');
    f.failCancel=false;f.approve(order.id);const late=await f.orders.reconcile(order.id,f.buyer);assert.equal(late.status,'PAYMENT_REVIEW');assert.equal(late.paymentStatus,'APPROVED');assert.equal(await f.stock(p.variantId),1);assert.equal((await db.prepare("SELECT status FROM inventory_reservations WHERE order_id=?").get(next.id)).status,'ACTIVE');assert.equal((await f.messages(order.id)).filter(m=>m.template==='order-preparing').length,0);assert.ok((await f.messages(order.id)).filter(m=>m.template==='admin-order-paid').every(m=>m.data.needsReview===true));
    for(const remoteStatus of ['canceled','failed']){const resource=f.remotes.get(order.id);resource.status=remoteStatus;resource.status_detail='expired';resource.last_updated_date=new Date(f.now+1).toISOString();const preserved=await f.orders.reconcile(order.id,f.buyer);assert.equal(preserved.paymentStatus,'APPROVED','uma notificação de expiração não apaga dinheiro já recebido');assert.equal(preserved.status,'PAYMENT_REVIEW');assert.equal(await f.stock(p.variantId),1);}assert.equal((await f.messages(order.id)).filter(m=>m.template==='payment-approved').length,1);
    const q=await f.product(),pending=await f.orders.create(f.payload(q.variantId,'pix'),f.buyer);f.now+=RESERVATION_MS+1;f.failCancel=true;await f.orders.expireDue({orderId:pending.id});const cancels=f.cancels;f.failCancel=false;await f.orders.expireDue({orderId:pending.id});assert.equal(f.cancels,cancels+1);assert.equal(JSON.parse((await db.prepare('SELECT payload_json FROM payments WHERE order_id=?').get(pending.id)).payload_json).expiryCancelState,'DONE');await f.orders.expireDue({orderId:pending.id});assert.equal(f.cancels,cancels+1);
  });
  await t.test('consulta atrasada confirma recurso já aprovado antes do prazo se a reserva não foi realocada',async()=>{
    const p=await f.product(),order=await f.orders.create(f.payload(p.variantId,'pix'),f.buyer);f.now+=14*60000;f.approve(order.id);f.now+=2*60000;
    const result=await f.orders.expireDue({orderId:order.id});assert.equal(result.reconciled,1);const row=await db.prepare('SELECT * FROM orders WHERE id=?').get(order.id);assert.equal(row.status,'CONFIRMED');assert.equal(row.shipping_status,'PROCESSING');assert.equal(await f.stock(p.variantId),0);
  });
  await t.test('criação inconclusiva expira; webhook com ID recuperado cancela a cobrança sem novo POST de compra',async()=>{
    const p=await f.product(),order=await f.orders.create(f.payload(p.variantId),f.buyer);f.ambiguousCreate=true;
    await assert.rejects(f.orders.payment(order.id,f.card,f.buyer),e=>e.code==='PAYMENT_RECONCILIATION_REQUIRED');f.ambiguousCreate=false;const posts=f.posts;
    await assert.rejects(f.orders.payment(order.id,f.card,f.buyer),e=>e.code==='PAYMENT_RECONCILIATION_REQUIRED');assert.equal(f.posts,posts);f.now+=RESERVATION_MS+1;await f.orders.expireDue({orderId:order.id});
    await f.orders.webhook(f.sign(f.remotes.get(order.id)));await f.orders.expireDue({orderId:order.id});assert.equal(f.posts,posts);assert.equal((await db.prepare('SELECT status,payment_status FROM orders WHERE id=?').get(order.id)).status,'CANCELLED');assert.equal(await f.stock(p.variantId),1);
  });
  await t.test('falha na outbox reverte financeiro e estoque; reconciliação retoma sem duplicação',async()=>{
    const p=await f.product(),order=await f.orders.create(f.payload(p.variantId),f.buyer);f.approveOnCreate=true;f.failEmail=true;
    await assert.rejects(f.orders.payment(order.id,f.card,f.buyer),e=>e.code==='PAYMENT_RECONCILIATION_REQUIRED');f.failEmail=false;f.approveOnCreate=false;assert.equal(await f.stock(p.variantId),1);assert.equal((await db.prepare('SELECT payment_status FROM orders WHERE id=?').get(order.id)).payment_status,'PENDING');await f.orders.reconcile(order.id,f.buyer);assert.equal(await f.stock(p.variantId),0);assert.equal((await f.messages(order.id)).filter(m=>m.to===f.buyer.email).length,4);
  });
  await t.test('worker de produção não consulta nem expira tentativa preparada em sandbox',async()=>{
    const p=await f.product(),order=await f.orders.create(f.payload(p.variantId),f.buyer);f.now+=RESERVATION_MS+1;let reads=0;
    const production=createOrders({db,quote:async()=>{throw new Error('not needed');},env:{...env,BKM_ENVIRONMENT:'production',MERCADO_PAGO_ENVIRONMENT:'production',MERCADO_PAGO_PRODUCTION_APPROVED:'true'},ApiError,now:()=>f.now,audit:async()=>{},paymentProvider:{async getPayment(){reads++;throw new Error('must not contact another environment');}}});
    const result=await production.expireDue({orderId:order.id});assert.equal(result.expired,0);assert.equal(reads,0);assert.equal((await db.prepare('SELECT status FROM orders WHERE id=?').get(order.id)).status,'PENDING');assert.equal((await db.prepare('SELECT status FROM inventory_reservations WHERE order_id=?').get(order.id)).status,'ACTIVE');const shown=await production.serialize(await db.prepare('SELECT * FROM orders WHERE id=?').get(order.id));assert.equal(shown.payment.environment,'sandbox');assert.equal(shown.payment.sandbox,true);
    assert.equal((await f.orders.expireDue({orderId:order.id})).expired,1,'o consumidor do ambiente correto ainda processa a expiração');
  });
  await t.test('cancelamento remoto falho não bloqueia a expiração de pedidos novos na fila',async sub=>{
    const isolated=await fixture(engine,sub),localDb=isolated.db;
    const a=await isolated.product(),old=await isolated.orders.create(isolated.payload(a.variantId,'pix'),isolated.buyer);isolated.now+=RESERVATION_MS+1;isolated.failCancel=true;await isolated.orders.expireDue({orderId:old.id});
    const b=await isolated.product(),recent=await isolated.orders.create(isolated.payload(b.variantId),isolated.buyer);isolated.now+=RESERVATION_MS+1;
    await localDb.prepare('UPDATE orders SET updated_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z',old.id);const cancels=isolated.cancels;
    const result=await isolated.orders.expireDue({limit:1});assert.equal(result.expired,1);assert.equal((await localDb.prepare('SELECT status FROM orders WHERE id=?').get(recent.id)).status,'CANCELLED');assert.equal(isolated.cancels,cancels,'a reserva vencida nova tem prioridade sobre um cancelamento antigo');
    await isolated.orders.expireDue({orderId:old.id});assert.notEqual((await localDb.prepare('SELECT updated_at FROM orders WHERE id=?').get(old.id)).updated_at,'2000-01-01T00:00:00.000Z','a tentativa falha gira para o fim da fila de novas tentativas');
  });
});
