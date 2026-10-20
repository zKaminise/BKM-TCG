const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {once}=require('node:events');
const {DatabaseSync}=require('node:sqlite');
const {PGlite}=require('@electric-sql/pglite');
const {createServer}=require('../serve.cjs');
const {hashPassword}=require('../server/auth.cjs');
const {PaymentError,verifyWebhookSignature}=require('../server/payments.cjs');

// All provider traffic is replaced by this injected transport. The fixture
// credentials are deliberately unusable and never call Mercado Pago's network.
const sandboxEnv={BKM_ENVIRONMENT:'staging',PAYMENT_PROVIDER:'mercadopago',EMAIL_PROVIDER:'disabled',
  MERCADO_PAGO_ENABLED:'true',MERCADO_PAGO_ENVIRONMENT:'sandbox',MERCADO_PAGO_ACCESS_TOKEN:'fixture-not-a-real-token',
  MERCADO_PAGO_PUBLIC_KEY:'fixture-not-a-real-public-key',MERCADO_PAGO_WEBHOOK_SECRET:'fixture-webhook-secret',MERCADO_PAGO_SELLER_ID:'123456'};

test('diagnóstico interno MP mantém rejeição pública e motivo não enumerável sem dados assinados',()=>{
  const secret='diagnostic-fixture-secret-never-real',requestId='diagnostic-private-request',dataId='ORDDIAGNOSTIC123456',ts=String(Date.now());
  const sign=(timestamp=ts,key=secret)=>`ts=${timestamp},v1=${crypto.createHmac('sha256',key).update(`id:${dataId.toLowerCase()};request-id:${requestId};ts:${timestamp};`).digest('hex')}`;
  const valid={secret,requestId,dataId,signature:sign(),now:Number(ts)};
  assert.equal(verifyWebhookSignature(valid).verified,true);
  const cases=[
    ['HEADER_FORMAT',{requestId:undefined}],['HEADER_FORMAT',{dataId:'private.invalid/resource'}],['HEADER_FORMAT',{signature:undefined}],
    ['SIGNATURE_FORMAT',{signature:sign()+`,ts=${ts}`}],['SIGNATURE_FORMAT',{signature:`ts=${ts},v1=not-hex`}],
    ['TIMESTAMP_WINDOW',{now:Number(ts)+600001}],['TIMESTAMP_WINDOW',{now:Number(ts)-600001}],
    ['HMAC_MISMATCH',{signature:sign(ts,'different-private-fixture-secret')}],['HMAC_MISMATCH',{dataId:'ORDOTHERDIAGNOSTIC123'}]
  ];
  for(const [reason,patch]of cases)assert.throws(()=>verifyWebhookSignature({...valid,...patch}),error=>{
    assert.equal(error.status,401);assert.equal(error.statusCode,401);assert.equal(error.code,'PAYMENT_WEBHOOK_INVALID');assert.equal(error.message,'Assinatura da notificação inválida.');
    assert.equal(error.diagnosticCode,reason);assert.equal(Object.getOwnPropertyDescriptor(error,'diagnosticCode').enumerable,false);
    const serialized=JSON.stringify(error),spread=JSON.stringify({...error});
    for(const sensitive of [secret,requestId,dataId,valid.signature,patch.signature,patch.dataId,reason,'diagnosticCode'].filter(Boolean)){
      assert.equal(serialized.includes(sensitive),false);assert.equal(spread.includes(sensitive),false);assert.equal(String(error).includes(sensitive),false);
    }
    return true;
  });
  assert.throws(()=>verifyWebhookSignature({...valid,secret:''}),error=>error.status===503&&!Object.hasOwn(error,'diagnosticCode'));
});

test('diagnóstico interno MP registra só marcador e reason permitido na rota, sem alterar HTTP401',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'bkm-mp-diagnostic-'));
  let providerReads=0;
  const gateway={async request(){providerReads++;const error=new PaymentError(401,'PAYMENT_WEBHOOK_INVALID','Assinatura da notificação inválida.');Object.defineProperty(error,'diagnosticCode',{value:'private-untrusted-reason'});throw error;}};
  const server=createServer({root:directory,dbPath:path.join(directory,'isolated.sqlite'),databaseUrl:'',env:sandboxEnv,paymentProvider:gateway});
  await server.api.ready;server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await server.api.close();fs.rmSync(directory,{recursive:true,force:true});});
  const warnings=[];t.mock.method(console,'warn',(...args)=>warnings.push(args));
  const base='http://127.0.0.1:'+server.address().port,requestId='private-diagnostic-request-id',dataId='ORDPRIVATE123456789',secret=sandboxEnv.MERCADO_PAGO_WEBHOOK_SECRET;
  const sign=(timestamp=String(Date.now()),key=secret)=>`ts=${timestamp},v1=${crypto.createHmac('sha256',key).update(`id:${dataId.toLowerCase()};request-id:${requestId};ts:${timestamp};`).digest('hex')}`;
  const call=async(headers)=>{const response=await fetch(base+'/api/payments/webhook/mercadopago?data.id='+dataId,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify({privateBodyMarker:'private-body-must-not-log',secret})});return{status:response.status,body:await response.json()};};
  const fixtures=[
    ['HEADER_FORMAT',{'x-signature':sign()}],
    ['SIGNATURE_FORMAT',{'x-request-id':requestId,'x-signature':'ts=1,v1=invalid-private-signature'}],
    ['TIMESTAMP_WINDOW',{'x-request-id':requestId,'x-signature':sign(String(Date.now()-600001))}],
    ['HMAC_MISMATCH',{'x-request-id':requestId,'x-signature':sign(String(Date.now()),'wrong-private-diagnostic-secret')}]
  ];
  for(const [reason,headers]of fixtures){
    const response=await call(headers);assert.equal(response.status,401);assert.deepEqual(response.body,{error:{code:'PAYMENT_WEBHOOK_INVALID',message:'Assinatura da notificação inválida.'}});
    assert.deepEqual(warnings.at(-1),['BKM_MP_WEBHOOK_REJECTED',{reason}]);
    const output=JSON.stringify({response:response.body,warnings});
    for(const sensitive of [secret,requestId,dataId,headers['x-signature'],'private-body-must-not-log','127.0.0.1'])assert.equal(output.includes(sensitive),false);
    assert.equal(JSON.stringify(response.body).includes(reason),false);
  }
  assert.equal(providerReads,0,'assinaturas recusadas não devem consultar o provedor');
  assert.equal(warnings.length,4);
  const forged=await call({'x-request-id':requestId,'x-signature':sign()});assert.equal(forged.status,401);assert.equal(providerReads,1);
  assert.equal(warnings.length,4,'um diagnóstico fora da whitelist não deve ser registrado');
  const other=await fetch(base+'/api/account/orders');assert.equal(other.status,401);assert.equal(warnings.length,4,'outras rotas não devem emitir o marcador de webhook');
});

for(const engine of ['sqlite','postgres']) test(`Mercado Pago ligado à API, com transporte isolado: ${engine}`,async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'bkm-mp-api-')),dbPath=path.join(directory,'sandbox.sqlite');
  let pg,pgClient,db,creates=0,reads=0,next='pending';const remoteById=new Map();
  if(engine==='postgres') {pg=new PGlite();pgClient={query:async(sql,args)=>args?.length?pg.query(sql,args):(await pg.exec(sql)).at(-1),end:()=>pg.close()};}
  const gateway={
    async createPayment(input) {
      creates++;
      assert.equal(input.amountCents,11500);assert.equal(input.currency,'BRL');assert.match(input.idempotencyKey,/^[a-f0-9]{64}$/);
      assert.equal(input.payer.email,'buyer@testuser.com');
      const row=await db.prepare('SELECT * FROM orders WHERE id=?').get(input.orderId);
      assert.equal(row.payment_status,'PENDING');assert.equal(row.total_cents,11500);
      assert.equal((await db.prepare("SELECT COUNT(*) n FROM inventory_reservations WHERE order_id=? AND status='ACTIVE'").get(input.orderId)).n,1);
      if(engine==='sqlite') {
        // A separate connection must see the saved order before remote I/O.
        const reader=new DatabaseSync(dbPath,{readOnly:true});
        try {assert.equal(reader.prepare('SELECT total_cents FROM orders WHERE id=?').get(input.orderId).total_cents,11500);}
        finally {reader.close();}
      }
      const id='ORDSANDBOX'+String(creates).padStart(8,'0');
      const remote={id,provider:'mercadopago',demo:false,sandbox:true,status:'PENDING',orderId:input.orderId,
        amountCents:input.amountCents,currency:'BRL',eventId:id+':pending',pix:{copyPaste:'transport-fixture-only'},occurredAt:new Date().toISOString()};
      remoteById.set(id,remote);
      if(next==='ambiguous') {const error=new PaymentError(504,'PAYMENT_TIMEOUT','Resposta inconclusiva.',{retryable:true,reconciliationRequired:true});error.providerPaymentId=id;throw error;}
      if(next==='rejected') throw new PaymentError(422,'PAYMENT_REJECTED','Dados recusados pelo provedor.');
      return remote;
    },
    async getPayment(id,expected) {reads++;const remote=remoteById.get(id);assert.ok(remote);assert.equal(remote.orderId,expected.orderId);assert.equal(remote.amountCents,expected.amountCents);return remote;},
    async request(method,route) {reads++;assert.equal(method,'GET');const remote=remoteById.get(decodeURIComponent(route.split('/').at(-1)));assert.ok(remote);return {external_reference:remote.orderId,remote};},
    normalize(raw,expected) {assert.equal(raw.remote.orderId,expected.orderId);assert.equal(raw.remote.amountCents,expected.amountCents);assert.equal(raw.remote.id,expected.paymentId);return raw.remote;}
  };
  const server=createServer({root:directory,dbPath,pgClient,env:sandboxEnv,paymentProvider:gateway});
  await server.api.ready;db=server.api.asyncStore;server.listen(0,'127.0.0.1');await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port;
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await server.api.close();fs.rmSync(directory,{recursive:true,force:true});});
  class Client {
    constructor(){this.cookie='';this.csrf='';}
    async call(route,{method='GET',body,headers={}}={}) {
      const response=await fetch(base+route,{method,headers:{...(this.cookie?{cookie:this.cookie}:{}),...(this.csrf?{'x-csrf-token':this.csrf}:{}),...(body?{'content-type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});
      if(response.headers.get('set-cookie'))this.cookie=response.headers.get('set-cookie').split(';')[0];
      const data=await response.json();if(data.csrfToken)this.csrf=data.csrfToken;return {status:response.status,data};
    }
    async init(){await this.call('/api/session');return this;}
  }
  const admin=await new Client().init(),customer=await new Client().init(),other=await new Client().init(),anon=new Client();
  const adminId=crypto.randomUUID(),stamp=new Date().toISOString();
  await db.prepare("INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,'ADMIN',?)").run(adminId,'admin@example.test','Administrador',await hashPassword('admin-test-password'),stamp);
  assert.equal((await admin.call('/api/auth/login',{method:'POST',body:{email:'admin@example.test',password:'admin-test-password'}})).status,200);
  assert.equal((await customer.call('/api/auth/register',{method:'POST',body:{name:'Cliente',email:'buyer@testuser.com',password:'customer-test-password'}})).status,201);
  assert.equal((await other.call('/api/auth/register',{method:'POST',body:{name:'Outro',email:'another@testuser.com',password:'another-test-password'}})).status,201);
  assert.equal((await admin.call('/api/admin/settings',{method:'PUT',body:{shipping:{enabled:true,flatRateCents:1500,estimatedDays:5,freeShippingEnabled:false,freeShippingThresholdCents:null,regions:[]}}})).status,200);
  let product=(await admin.call('/api/admin/products',{method:'POST',body:{kind:'SEALED',name:'Booster de teste isolado',slug:'isolated-booster',sku:'MP-TEST-ISOLATED',description:'Somente fixture.',setId:'test-set',setName:'Teste',published:true,images:[{url:'/assets/pack.webp',kind:'reference'}],variants:[{language:'pt',condition:'SEALED',finish:'NORMAL',priceCents:10000,stock:1}]}})).data;
  assert.ok(product.id);
  const payload=()=>({items:[{variantId:product.variants[0].id,quantity:1,priceCents:1}],totalCents:1,contact:{name:'Cliente',email:'buyer@testuser.com',phone:'11999999999'},address:{name:'Cliente',phone:'11999999999',zip:'01001000',street:'Rua Teste',number:'1',district:'Centro',city:'São Paulo',state:'SP'},payment:{provider:'mercadopago',method:'pix',payer:{email:'buyer@testuser.com'}},idempotencyKey:crypto.randomUUID()});
  const replenish=async stock=>{const result=await admin.call('/api/admin/products/'+product.id,{method:'PUT',body:{...product,variants:product.variants.map(v=>({...v,stock}))}});assert.equal(result.status,200,JSON.stringify(result.data));product=result.data;};
  let order,original;
  await t.test('checkout salva os valores do servidor antes do provedor e repete sem nova cobrança',async()=>{
    const config=(await customer.call('/api/config')).data;
    assert.equal(config.payments.available,true);assert.equal(config.payments.environment,'sandbox');assert.equal(config.payments.publicKey,sandboxEnv.MERCADO_PAGO_PUBLIC_KEY);assert.ok(!JSON.stringify(config).includes(sandboxEnv.MERCADO_PAGO_ACCESS_TOKEN));
    original=payload();const created=await customer.call('/api/checkout',{method:'POST',body:original});assert.equal(created.status,201,JSON.stringify(created.data));order=created.data.order;
    assert.match(order.number,/^TESTE-/);assert.equal(order.environment,'production');assert.equal(order.demo,false);assert.equal(order.payment.environment,'sandbox');assert.equal(order.payment.sandbox,true);assert.equal(order.payment.pix.copyPaste,'transport-fixture-only');assert.equal(order.totalCents,11500);assert.equal(creates,1);
    assert.equal((await customer.call('/api/checkout',{method:'POST',body:original})).data.order.id,order.id);assert.equal(creates,1);
    assert.equal((await customer.call('/api/products?available=true')).data.pagination.total,0);
    const unavailable=await other.call('/api/checkout',{method:'POST',body:payload()});assert.equal(unavailable.status,409);assert.equal(creates,1);
    const conflict=await customer.call('/api/checkout',{method:'POST',body:{...original,contact:{...original.contact,name:'Alterado'}}});assert.equal(conflict.status,409);assert.equal(creates,1);
  });
  await t.test('consulta e reconciliação exigem autenticação, CSRF e propriedade',async()=>{
    assert.equal((await anon.call('/api/account/orders/'+order.id+'/reconcile',{method:'POST'})).status,403);
    await anon.init();assert.equal((await anon.call('/api/account/orders/'+order.id+'/reconcile',{method:'POST'})).status,401);
    assert.equal((await other.call('/api/account/orders/'+order.id+'/reconcile',{method:'POST'})).status,404);
    assert.equal((await other.call('/api/account/orders/'+order.id+'/payment',{method:'POST',body:{payment:original.payment}})).status,404);
    assert.equal((await customer.call('/api/admin/orders/'+order.id+'/reconcile',{method:'POST'})).status,403);
    assert.equal((await customer.call('/api/account/orders/'+order.id+'/simulate',{method:'POST',body:{outcome:'approved'}})).status,403);
    assert.equal((await admin.call('/api/admin/orders/'+order.id+'/reconcile',{method:'POST'})).status,200);assert.equal(reads,1);
  });
  await t.test('webhook ignora corpo não assinado, valida HMAC e confirma uma única baixa de estoque',async()=>{
    const route='/api/payments/webhook/mercadopago?data.id='+order.payment.providerId;
    const invalid=await anon.call(route,{method:'POST',body:{data:{id:'ORDWRONGBODY0001'},status:'approved'},headers:{cookie:'','x-csrf-token':''}});assert.equal(invalid.status,401);assert.equal(reads,1);
    const remote=remoteById.get(order.payment.providerId);remote.status='APPROVED';remote.eventId=remote.id+':approved';
    function signature(requestId) {const ts=String(Date.now());return 'ts='+ts+',v1='+crypto.createHmac('sha256',sandboxEnv.MERCADO_PAGO_WEBHOOK_SECRET).update('id:'+remote.id.toLowerCase()+';request-id:'+requestId+';ts:'+ts+';').digest('hex');}
    for(const requestId of ['signed-request-one','signed-request-two']) {
      const result=await anon.call(route,{method:'POST',body:{data:{id:'ORDWRONGBODY0001'},status:'rejected'},headers:{cookie:'','x-csrf-token':'','x-request-id':requestId,'x-signature':signature(requestId)}});assert.equal(result.status,200,JSON.stringify(result.data));assert.deepEqual(result.data,{received:true});
    }
    const confirmed=(await customer.call('/api/account/orders/'+order.id)).data;assert.equal(confirmed.status,'CONFIRMED');assert.equal(confirmed.paymentStatus,'APPROVED');
    assert.equal((await db.prepare('SELECT stock FROM variants WHERE id=?').get(product.variants[0].id)).stock,0);
    assert.equal((await db.prepare("SELECT COUNT(*) n FROM stock_movements WHERE variant_id=? AND delta=-1").get(product.variants[0].id)).n,1);
    assert.equal((await db.prepare("SELECT COUNT(*) n FROM order_history WHERE order_id=? AND type='PAYMENT' AND status='APPROVED'").get(order.id)).n,1);
    assert.equal((await admin.call('/api/admin/orders/'+order.id+'/shipping',{method:'PATCH',body:{status:'SHIPPED',trackingCode:'TEST123',trackingUrl:'https://example.test/tracking'}})).status,200);
    const events=(await db.prepare('SELECT COUNT(*) n FROM order_history WHERE order_id=?').get(order.id)).n;
    assert.equal((await admin.call('/api/admin/orders/'+order.id+'/shipping',{method:'PATCH',body:{status:'SHIPPED',trackingCode:'TEST123',trackingUrl:'https://example.test/tracking'}})).status,200);
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM order_history WHERE order_id=?').get(order.id)).n,events);
  });
  await t.test('revisão de estoque bloqueia envio mesmo com pagamento aprovado',async()=>{
    await db.prepare("UPDATE orders SET status='PAYMENT_REVIEW' WHERE id=?").run(order.id);
    assert.equal((await admin.call('/api/admin/orders/'+order.id+'/shipping',{method:'PATCH',body:{status:'DELIVERED'}})).status,409);
  });
  await t.test('erros definitivos liberam reservas e dados de cartão não tokenizados são recusados',async()=>{
    await replenish(1);
    const raw=payload();raw.payment={provider:'mercadopago',method:'card',payer:{email:'buyer@testuser.com'},card:{number:'4111111111111111',cvv:'123'}};
    const before=creates;assert.equal((await customer.call('/api/checkout',{method:'POST',body:raw})).status,422);assert.equal(creates,before);
    next='rejected';const rejected=await customer.call('/api/checkout',{method:'POST',body:payload()});assert.equal(rejected.status,422);assert.ok(rejected.data.error.fields.orderId);
    assert.equal((await db.prepare("SELECT COUNT(*) n FROM inventory_reservations WHERE order_id=? AND status='ACTIVE'").get(rejected.data.error.fields.orderId)).n,0);
    assert.equal((await customer.call('/api/account/orders/'+rejected.data.error.fields.orderId)).data.status,'CANCELLED');
  });
  await t.test('resposta inconclusiva mantém o pedido, permite reconciliação e não cria cobrança substituta',async()=>{
    next='ambiguous';const data=payload(),created=await customer.call('/api/checkout',{method:'POST',body:data});assert.equal(created.status,503);assert.equal(created.data.error.code,'PAYMENT_RECONCILIATION_REQUIRED');const id=created.data.error.fields.orderId;assert.ok(id);
    const before=creates,pending=(await customer.call('/api/account/orders/'+id)).data;assert.equal(pending.paymentStatus,'PENDING');assert.equal(pending.status,'PENDING');
    assert.equal((await customer.call('/api/checkout',{method:'POST',body:data})).data.order.id,id);assert.equal(creates,before);
    const retry=await customer.call('/api/account/orders/'+id+'/payment',{method:'POST',body:{payment:data.payment}});
    assert.equal(retry.status,200,JSON.stringify(retry.data));assert.equal(retry.data.order.paymentStatus,'PENDING');assert.equal(creates,before);
    const remote=[...remoteById.values()].find(value=>value.orderId===id);remote.status='APPROVED';remote.eventId=remote.id+':approved';
    const reconciled=await customer.call('/api/account/orders/'+id+'/reconcile',{method:'POST'});assert.equal(reconciled.status,200,JSON.stringify(reconciled.data));assert.equal(reconciled.data.order.status,'CONFIRMED');assert.equal(creates,before);
  });
  await t.test('banco demonstrativo nunca aceita uma cobrança externa',async()=>{
    await replenish(1);
    const saved=await db.prepare('SELECT value_json FROM settings WHERE id=1').get(),settings=JSON.parse(saved.value_json);settings.demoDataVersion=1;
    await db.prepare('UPDATE settings SET value_json=? WHERE id=1').run(JSON.stringify(settings));
    const before=creates;const config=(await customer.call('/api/config')).data;assert.equal(config.payments.available,false);assert.equal(config.payments.publicKey,undefined);
    const response=await customer.call('/api/checkout',{method:'POST',body:payload()});assert.equal(response.status,409);assert.equal(response.data.error.code,'DEMO_DATABASE');assert.equal(creates,before);
  });
});
