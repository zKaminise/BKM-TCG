'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {openStore}=require('./store.cjs');
const {createMercadoPagoService}=require('./payment-service.cjs');
const {MercadoPagoPaymentProvider,PaymentError}=require('./payments.cjs');
const {createEmailStore}=require('./email-store.cjs');
const {createEmailDispatcher}=require('./email.cjs');
const env={BKM_ENVIRONMENT:'staging',PAYMENT_PROVIDER:'mercadopago',MERCADO_PAGO_ENABLED:'true',MERCADO_PAGO_ENVIRONMENT:'sandbox',MERCADO_PAGO_ACCESS_TOKEN:'unit-only-no-real-credential',MERCADO_PAGO_PUBLIC_KEY:'unit-only-public',MERCADO_PAGO_WEBHOOK_SECRET:'unit-only-webhook-secret',MERCADO_PAGO_SELLER_ID:'12345678',BKM_PUBLIC_URL:'https://bkm.example.test',EMAIL_PROVIDER:'development'};
const uid=()=>crypto.randomUUID();
const at=Date.parse('2026-10-15T16:00:00Z');
const input={method:'pix',payer:{email:'buyer@testuser.com'}};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status});

async function fixture(engine,t){
  const pg=engine==='postgres'?new PGlite():null;
  const pgClient=pg?{query:async(sql,args)=>args?.length?pg.query(sql,args):(await pg.exec(sql)).at(-1),end:()=>pg.close()}:undefined;
  const db=openStore({dbPath:':memory:',pgClient,env:{}});await db.ready;t.after(()=>db.close());
  const userId=uid(),created=new Date(at).toISOString();
  await db.prepare("INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,'not-used-for-login','CUSTOMER',?)").run(userId,'buyer@testuser.com','Comprador de teste',created);
  const f={db,now:at,remotes:new Map(),posts:0,gets:0,getFail:false,failEmail:false,localFailure:false};
  const outbox=createEmailStore(db);
  f.serialize=async row=>({...row,number:row.number,contact:JSON.parse(row.contact_json),history:await db.prepare('SELECT * FROM order_history WHERE order_id=?').all(row.id)});
  f.provider=new MercadoPagoPaymentProvider({env,now:()=>f.now,fetchImpl:async(url,options)=>{
    if(options.method==='POST'){
      f.posts++;
      const body=JSON.parse(options.body),remote=f.remotes.get(body.external_reference);assert.ok(remote);
      if(f.postGate)await f.postGate();
      if(f.postFailure)return json({error:'temporary'},503);
      return json({id:remote.id,status:remote.status,total_amount:remote.total_amount});
    }
    f.gets++;
    if(f.getFail)return json({error:'temporary'},503);
    const id=url.split('/').pop(),remote=[...f.remotes.values()].find(row=>row.id===id);
    return remote?json(remote):json({error:'not_found'},404);
  }});
  f.service=createMercadoPagoService({db,env,provider:f.provider,now:()=>f.now,serializeOrder:f.serialize,
    audit:async()=>{if(f.localFailure)throw new Error('simulated local persistence failure');},
    enqueueEmail:async message=>{if(f.failEmail)throw new Error('simulated outbox failure');return outbox.enqueue(message);}});
  f.remote=(order,patch={})=>{
    const previous=f.remotes.get(order.id),id=previous?.id||'ORD'+uid().replace(/-/g,'').toUpperCase();
    const value={id,external_reference:order.id,user_id:env.MERCADO_PAGO_SELLER_ID,country_code:'BRA',currency_id:'BRL',live_mode:false,total_amount:(order.total_cents/100).toFixed(2),total_paid_amount:'0.00',status:'created',status_detail:'created',last_updated_date:new Date(f.now).toISOString(),transactions:{payments:[{amount:(order.total_cents/100).toFixed(2),paid_amount:'0.00',status:'created',status_detail:'created',payment_method:{id:'pix',type:'bank_transfer',qr_code:'unit-reference-not-a-commercial-pix'}}]},...patch};
    f.remotes.set(order.id,value);return value;
  };
  f.approve=(order,patch={})=>f.remote(order,{status:'processed',status_detail:'accredited',total_paid_amount:(order.total_cents/100).toFixed(2),transactions:{payments:[{amount:(order.total_cents/100).toFixed(2),paid_amount:((order.total_cents-200)/100).toFixed(2),status:'processed',status_detail:'accredited',payment_method:{id:'pix',type:'bank_transfer'}}]},...patch});
  f.order=async({stock=2,expiresAt=f.now+1800000,couponId=null}={})=>{
    const id=uid(),productId=uid(),variantId=uid();
    await db.prepare("INSERT INTO products(id,slug,kind,name,description,sku,tcg,set_id,set_name,images_json,search_text,published,created_at,updated_at) VALUES(?,?,'SINGLE','Carta de teste','Teste sem venda real',?,'pokemon','unit','Unit','[]','teste',1,?,?)").run(productId,'unit-'+productId,'UNIT-'+productId,created,created);
    await db.prepare("INSERT INTO variants(id,product_id,language,condition,finish,price_cents,stock) VALUES(?,?,'pt','NM','NORMAL',10000,?)").run(variantId,productId,stock);
    await db.prepare("INSERT INTO orders(id,user_id,status,payment_status,shipping_status,currency,subtotal_cents,discount_cents,shipping_cents,total_cents,coupon_id,address_json,idempotency_key,created_at,updated_at,number,environment,contact_json) VALUES(?,?,'PENDING','PENDING','UNFULFILLED','BRL',10000,0,0,10000,?,'{}',?,?,?,?,'production',?)").run(id,userId,couponId,'key-'+id,created,created,'UNIT-'+id,JSON.stringify({name:'Comprador',email:'buyer@testuser.com'}));
    await db.prepare("INSERT INTO order_items VALUES(?,?,?,?,?,'{}',1,10000,10000)").run(uid(),id,variantId,'Carta de teste','UNIT');
    await db.prepare("INSERT INTO inventory_reservations VALUES(?,?,?,1,'ACTIVE',?,?)").run(uid(),variantId,id,expiresAt,created);
    const row=await db.prepare('SELECT * FROM orders WHERE id=?').get(id);row.variantId=variantId;f.remote(row);return row;
  };
  f.stock=async order=>(await db.prepare('SELECT stock FROM variants WHERE id=?').get(order.variantId)).stock;
  f.payment=async order=>db.prepare('SELECT * FROM payments WHERE order_id=?').get(order.id);
  f.sign=remote=>{const requestId=uid(),ts=String(f.now),dataId=remote.id;return {dataId,requestId,signature:`ts=${ts},v1=${crypto.createHmac('sha256',env.MERCADO_PAGO_WEBHOOK_SECRET).update(`id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`).digest('hex')}`};};
  return f;
}

for(const engine of ['sqlite','postgres'])test('ledger Mercado Pago com banco '+engine,async t=>{
  const f=await fixture(engine,t),db=f.db;
  await t.test('criação, webhook duplicado, estoque e cupom são aplicados uma única vez',async()=>{
    const couponId=uid();await db.prepare("INSERT INTO coupons(id,code,type,value,max_uses,created_at) VALUES(?,?,'PERCENT',10,1,?)").run(couponId,'UNIT-'+couponId,new Date(at).toISOString());
    const order=await f.order({couponId});f.approve(order);
    const created=await f.service.createPayment(order,input);assert.equal(created.status,'CONFIRMED');assert.equal(created.payment_status,'APPROVED');assert.equal(await f.stock(order),1);
    assert.equal((await db.prepare('SELECT used_count FROM coupons WHERE id=?').get(couponId)).used_count,1);
    const signed=f.sign(f.remotes.get(order.id));await f.service.webhook(signed);await f.service.webhook(signed);await f.service.reconcile(order.id);await f.service.createPayment(order,input);
    assert.equal(await f.stock(order),1);assert.equal(f.posts,1);
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM stock_movements WHERE variant_id=?').get(order.variantId)).n,1);
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM email_outbox WHERE key=?').get('mp-payment:'+order.id+':approved')).n,1);
    await assert.rejects(f.service.createPayment(order,{...input,method:'card'}),error=>error.code==='PAYMENT_IDEMPOTENCY_CONFLICT');
    const bad={...signed,signature:signed.signature.replace(/.$/,signed.signature.endsWith('0')?'1':'0')},gets=f.gets;
    await assert.rejects(f.service.webhook(bad),error=>error.status===401);assert.equal(f.gets,gets);
  });
  await t.test('resultado desconhecido com ID preservado permite consulta sem nova cobrança',async()=>{
    const order=await f.order();f.getFail=true;
    await assert.rejects(f.service.createPayment(order,input),error=>error.code==='PAYMENT_RECONCILIATION_REQUIRED');
    const payment=await f.payment(order);assert.equal(payment.status,'PENDING');assert.equal(JSON.parse(payment.payload_json).creationState,'UNKNOWN');
    assert.equal((await db.prepare('SELECT payment_provider_id FROM orders WHERE id=?').get(order.id)).payment_provider_id,f.remotes.get(order.id).id);
    const posts=f.posts;f.getFail=false;f.approve(order);
    await f.service.createPayment(order,input);assert.equal(f.posts,posts);assert.equal(await f.stock(order),1);
  });
  await t.test('tentativa preparada na transação conserva sandbox e bloqueia troca para produção',async()=>{
    const order=await f.order(),posts=f.posts;await db.transaction(()=>f.service.preparePayment(order));
    const prepared=await f.payment(order);assert.equal(JSON.parse(prepared.payload_json).gatewayEnvironment,'sandbox');assert.equal(JSON.parse(prepared.payload_json).creationState,'READY');assert.equal(f.posts,posts);
    const productionEnv={...env,BKM_ENVIRONMENT:'production',MERCADO_PAGO_ENVIRONMENT:'production',MERCADO_PAGO_PRODUCTION_APPROVED:'true'};
    const productionService=createMercadoPagoService({db,env:productionEnv,provider:f.provider,serializeOrder:f.serialize});
    await assert.rejects(productionService.createPayment(order,input),error=>error.code==='PAYMENT_ENVIRONMENT_MISMATCH');
    await assert.rejects(productionService.reconcile(order.id),error=>error.code==='PAYMENT_ENVIRONMENT_MISMATCH');assert.equal(f.posts,posts);
  });
  await t.test('duas submissões enquanto o provedor responde criam uma só cobrança',async()=>{
    const order=await f.order();f.approve(order);
    let release,entered;const gate=new Promise(resolve=>{release=resolve;}),waiting=new Promise(resolve=>{entered=resolve;});
    f.postGate=async()=>{entered();await gate;};const before=f.posts;
    const first=f.service.createPayment(order,input);await waiting;
    try{await assert.rejects(f.service.createPayment(order,input),error=>error.code==='PAYMENT_RECONCILIATION_REQUIRED');}
    finally{release();f.postGate=null;}
    assert.equal((await first).status,'CONFIRMED');assert.equal(f.posts,before+1);assert.equal(await f.stock(order),1);
  });
  await t.test('timeout na criação sem ID é recuperado pelo webhook autenticado',async()=>{
    const order=await f.order();f.postFailure=true;
    await assert.rejects(f.service.createPayment(order,input),error=>error.code==='PAYMENT_RECONCILIATION_REQUIRED');f.postFailure=false;
    await assert.rejects(f.service.createPayment(order,input),error=>error.code==='PAYMENT_RECONCILIATION_REQUIRED');
    f.approve(order);assert.equal((await f.service.webhook(f.sign(f.remotes.get(order.id)))).status,'CONFIRMED');assert.equal(await f.stock(order),1);
  });
  await t.test('falha local após aprovação mantém reserva e fato financeiro reconciliável',async()=>{
    const order=await f.order();f.approve(order);f.localFailure=true;
    await assert.rejects(f.service.createPayment(order,input),error=>error.code==='PAYMENT_RECONCILIATION_REQUIRED');f.localFailure=false;
    assert.equal(await f.stock(order),2);assert.equal((await f.payment(order)).status,'PENDING');
    assert.equal((await db.prepare("SELECT status FROM inventory_reservations WHERE order_id=?").get(order.id)).status,'ACTIVE');
    await f.service.reconcile(order.id);assert.equal(await f.stock(order),1);
  });
  await t.test('aprovação tardia sem reserva ou cupom disponível exige revisão, sem prometer estoque',async()=>{
    const expired=await f.order({stock:0,expiresAt:f.now-1});f.approve(expired);
    const result=await f.service.createPayment(expired,input);assert.equal(result.payment_status,'APPROVED');assert.equal(result.status,'PAYMENT_REVIEW');assert.equal(await f.stock(expired),0);
    const couponId=uid();await db.prepare("INSERT INTO coupons(id,code,type,value,max_uses,used_count,created_at) VALUES(?,?,'PERCENT',10,1,1,?)").run(couponId,'UNIT-'+couponId,new Date(at).toISOString());
    const exhausted=await f.order({couponId});f.approve(exhausted);assert.equal((await f.service.createPayment(exhausted,input)).status,'PAYMENT_REVIEW');assert.equal(await f.stock(exhausted),2);
  });
  await t.test('notificação antiga e aprovação após reembolso não desfazem nem repetem baixa',async()=>{
    const order=await f.order();f.approve(order);await f.service.createPayment(order,input);assert.equal(await f.stock(order),1);
    f.now+=1000;f.remote(order,{status:'refunded',status_detail:'refunded'});assert.equal((await f.service.reconcile(order.id)).status,'REFUNDED');
    const refundEmails=await db.prepare("SELECT COUNT(*) n FROM email_outbox WHERE key=?").get('mp-payment:'+order.id+':refunded');assert.equal(Number(refundEmails.n),1);
    assert.equal(JSON.parse((await db.prepare('SELECT payload_json FROM email_outbox WHERE key=?').get('mp-payment:'+order.id+':refunded')).payload_json).template,'order-refunded');
    await f.service.reconcile(order.id);assert.equal(Number((await db.prepare('SELECT COUNT(*) n FROM email_outbox WHERE key=?').get('mp-payment:'+order.id+':refunded')).n),1);
    f.now-=2000;f.approve(order);const stale=await f.service.reconcile(order.id);assert.equal(stale.payment_status,'REFUNDED');assert.equal(await f.stock(order),1);
    f.now+=5000;f.approve(order);const reversed=await f.service.reconcile(order.id);assert.equal(reversed.payment_status,'REFUNDED');assert.equal(await f.stock(order),1);
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM stock_movements WHERE variant_id=?').get(order.variantId)).n,1);
  });
  await t.test('cartão aprovado e reembolso Orders processed/refunded preservam baixa e deduplicam aviso',async()=>{
    const order=await f.order({stock:1}),cardInput={method:'card',payer:{email:'buyer@testuser.com'},card:{token:'unit-sdk-token-not-real',paymentMethodId:'master',type:'credit_card',installments:1}};
    const paymentId='PAY01CARDREFUND123',refundId='REF01CARDREFUND123';
    f.approve(order,{transactions:{payments:[{id:paymentId,amount:'100.00',paid_amount:'98.00',status:'processed',status_detail:'accredited',payment_method:{id:'master',type:'credit_card',installments:1}}]}});
    assert.equal((await f.service.createPayment(order,cardInput)).status,'CONFIRMED');assert.equal(await f.stock(order),0);
    const posts=f.posts;f.now+=1000;
    f.remote(order,{status:'processed',status_detail:'refunded',total_paid_amount:'100.00',transactions:{payments:[{id:paymentId,amount:'100.00',paid_amount:'98.00',status:'processed',status_detail:'accredited',payment_method:{id:'master',type:'credit_card',installments:1}}],refunds:[{id:refundId,transaction_id:paymentId,amount:'100.00',status:'processed'}]}});
    const proof=f.sign(f.remotes.get(order.id)),refunded=await f.service.webhook(proof);
    assert.equal(refunded.status,'REFUNDED');assert.equal(refunded.payment_status,'REFUNDED');
    await f.service.webhook(proof);await f.service.reconcile(order.id);
    assert.equal(await f.stock(order),0);assert.equal(f.posts,posts);
    assert.equal((await db.prepare('SELECT status FROM inventory_reservations WHERE order_id=?').get(order.id)).status,'COMMITTED');
    assert.equal(Number((await db.prepare('SELECT COUNT(*) n FROM stock_movements WHERE variant_id=?').get(order.variantId)).n),1);
    assert.equal(Number((await db.prepare('SELECT COUNT(*) n FROM email_outbox WHERE key=?').get('mp-payment:'+order.id+':refunded')).n),1);
    f.now+=1000;f.approve(order);
    assert.equal((await f.service.reconcile(order.id)).payment_status,'REFUNDED');assert.equal(await f.stock(order),0);
  });
  await t.test('valor ou vendedor incompatível não confirma e nem baixa estoque',async()=>{
    const order=await f.order();f.approve(order,{user_id:'9999'});
    await assert.rejects(f.service.createPayment(order,input),error=>error.code==='PAYMENT_RECONCILIATION_REQUIRED');assert.equal(await f.stock(order),2);
    await assert.rejects(f.service.webhook(f.sign(f.remotes.get(order.id))),error=>error.code==='PAYMENT_RECONCILIATION_MISMATCH');
    f.approve(order,{total_amount:'1.00'});await assert.rejects(f.service.reconcile(order.id),error=>error.code==='PAYMENT_RECONCILIATION_MISMATCH');assert.equal(await f.stock(order),2);
    f.approve(order);await f.service.reconcile(order.id);assert.equal(await f.stock(order),1);
    const demo=await f.order();await db.prepare("UPDATE orders SET environment='demo' WHERE id=?").run(demo.id);const posts=f.posts;
    await assert.rejects(f.service.createPayment(demo,input),error=>error.code==='PAYMENT_ENVIRONMENT_MISMATCH');assert.equal(f.posts,posts);
  });
  await t.test('rejeição definitiva libera reserva; e-mail e financeiro fazem rollback juntos',async()=>{
    const rejected=await f.order();f.remote(rejected,{status:'failed',status_detail:'failed'});assert.equal((await f.service.createPayment(rejected,input)).status,'CANCELLED');assert.equal(await f.stock(rejected),2);
    assert.equal((await db.prepare('SELECT status FROM inventory_reservations WHERE order_id=?').get(rejected.id)).status,'RELEASED');
    const order=await f.order();f.approve(order);f.failEmail=true;
    await assert.rejects(f.service.createPayment(order,input),error=>error.code==='PAYMENT_RECONCILIATION_REQUIRED');f.failEmail=false;assert.equal(await f.stock(order),2);
    await f.service.reconcile(order.id);assert.equal(await f.stock(order),1);
  });
  await t.test('outbox persiste deduplicação, leases e preview sem envio externo',async()=>{
    const outbox=createEmailStore(db),message={key:'unit/welcome/'+engine,template:'welcome',to:'buyer@testuser.com',data:{name:'Teste',demo:true}};
    const first=await outbox.enqueue(message),again=await outbox.enqueue({...message,data:{demo:true,name:'Teste'}});assert.equal(first.id,again.id);
    await assert.rejects(outbox.enqueue({...message,to:'other@example.test'}),error=>error.code==='EMAIL_EVENT_CONFLICT');
    // Isolate the row so a queue filled by the previous scenarios cannot mask it.
    await db.prepare("UPDATE email_outbox SET next_attempt_at=? WHERE id<>?").run(Date.now()+86400000,first.id);
    const row=(await outbox.claimDue({limit:1,now:Date.now(),leaseUntil:Date.now()+1000}))[0];assert.equal(row.id,first.id);
    const newer=(await outbox.claimDue({limit:1,now:Date.now()+2000,leaseUntil:Date.now()+10000}))[0];assert.equal(newer.id,first.id);
    assert.equal((await outbox.complete(row.id,{providerId:'stale',claim:row.claim})).changes,0);
    assert.equal((await outbox.retry(newer.id,{attempts:newer.claim.attempts,nextAttemptAt:Date.now(),errorCode:'TEST_RETRY',claim:newer.claim})).changes,1);
    const dispatcher=createEmailDispatcher({store:outbox,env:{BKM_ENVIRONMENT:'demo',BKM_PUBLIC_URL:env.BKM_PUBLIC_URL}});
    const result=await dispatcher.flush();assert.equal(result.previewed,1);assert.equal(result.sent,0);
    const stored=await db.prepare('SELECT * FROM email_outbox WHERE id=?').get(first.id);assert.equal(stored.status,'SENT');assert.equal(JSON.parse(stored.preview_json).externalSend,false);assert.equal(stored.attempts,3);
  });
});
