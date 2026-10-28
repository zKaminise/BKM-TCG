const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {once}=require('node:events');
const {createServer}=require('../serve.cjs');
const {hashPassword}=require('../server/auth.cjs');
const {openStore}=require('../server/store.cjs');
const {PGlite}=require('@electric-sql/pglite');

for(const engine of ['sqlite','postgres']) test(`checkout demonstrativo persistente: ${engine}`,async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'bkm-order-'));
  let pg,pgClient;
  if(engine==='postgres') {pg=new PGlite();pgClient={query:async(sql,args)=>args?.length?pg.query(sql,args):(await pg.exec(sql)).at(-1),end:()=>pg.close()};}
  const server=createServer({root:directory,dbPath:path.join(directory,'demo.sqlite'),pgClient,env:{BKM_ENVIRONMENT:'demo',PAYMENT_PROVIDER:'mock',EMAIL_PROVIDER:'development',PUBLIC_URL:'https://demo.example.test'}});
  await server.api.ready;
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port,db=server.api.asyncStore;
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await server.api.close().catch(()=>{});fs.rmSync(directory,{recursive:true,force:true});});
  class Client {
    constructor(){this.cookie='';this.csrf='';}
    async call(route,{method='GET',body}={}){const response=await fetch(base+route,{method,headers:{...(this.cookie?{cookie:this.cookie}:{}),...(this.csrf?{'x-csrf-token':this.csrf}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});if(response.headers.get('set-cookie'))this.cookie=response.headers.get('set-cookie').split(';')[0];const data=await response.json();if(data.csrfToken)this.csrf=data.csrfToken;return {status:response.status,data};}
    async init(){await this.call('/api/session');return this;}
  }
  const admin=await new Client().init(),customer=await new Client().init(),other=await new Client().init();
  const adminId=crypto.randomUUID(),stamp=new Date().toISOString();
  await db.prepare("INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,'ADMIN',?)").run(adminId,'admin@example.test','Administrador',await hashPassword('admin-test-password'),stamp);
  assert.equal((await admin.call('/api/auth/login',{method:'POST',body:{email:'admin@example.test',password:'admin-test-password'}})).status,200);
  assert.equal((await customer.call('/api/auth/register',{method:'POST',body:{name:'Cliente Demo',email:'cliente@example.test',password:'Customer1234'}})).status,201);
  assert.equal((await other.call('/api/auth/register',{method:'POST',body:{name:'Outro',email:'outro@example.test',password:'Another1234'}})).status,201);
  const settings={shipping:{enabled:true,flatRateCents:1500,estimatedDays:5,freeShippingEnabled:true,freeShippingThresholdCents:15000,regions:[{start:'01000000',end:'99999999'}]},categories:['Booster'],banners:[{title:'Demonstração',subtitle:'Sem vendas reais',image:'/assets/pack.webp',url:'/lacrados',active:true}]};
  assert.equal((await admin.call('/api/admin/settings',{method:'PUT',body:settings})).status,200);
  const productInput={kind:'SEALED',name:'Booster de teste',slug:'booster-teste',sku:'DEMO-TESTE',description:'Unidades fictícias.',setId:'demo-set',setName:'Coleção Demo',images:[{url:'/assets/pack.webp',kind:'reference'}],published:true,featured:true,variants:[{language:'pt',condition:'SEALED',finish:'NORMAL',priceCents:10000,stock:1}]};
  const saved=await admin.call('/api/admin/products',{method:'POST',body:productInput});assert.equal(saved.status,201,JSON.stringify(saved.data));let product=saved.data;
  const payload=(outcome='pending',variantId=product.variants[0].id)=>({items:[{variantId,quantity:1,priceCents:1}],coupon:'',contact:{name:'Cliente Demo',email:'cliente@example.test',phone:'11999999999'},address:{name:'Cliente Demo',phone:'11999999999',zip:'01001000',street:'Praça da Sé',number:'1',district:'Sé',city:'São Paulo',state:'SP'},payment:{provider:'mock',outcome},idempotencyKey:crypto.randomUUID()});
  let pending;
  await t.test('pedido pendente reserva última unidade; consulta respeita cliente',async()=>{
    const data=payload(),created=await customer.call('/api/checkout',{method:'POST',body:data});assert.equal(created.status,201,JSON.stringify(created.data));pending=created.data.order;
    assert.equal(pending.paymentStatus,'PENDING');assert.match(pending.number,/^DEMO-/);assert.equal(pending.totalCents,11500);assert.equal(pending.environment,'demo');assert.equal(pending.items[0].unitPriceCents,10000);assert.equal(pending.history.length,1);
    assert.equal((await other.call('/api/account/orders/'+pending.id)).status,404);assert.equal((await admin.call('/api/admin/orders/'+pending.id)).status,200);
    const retry=await customer.call('/api/checkout',{method:'POST',body:data});assert.equal(retry.status,201);assert.equal(retry.data.order.id,pending.id);
    const conflict=await customer.call('/api/checkout',{method:'POST',body:{...data,contact:{...data.contact,name:'Diferente'}}});assert.equal(conflict.status,409);
    const unavailable=await other.call('/api/checkout',{method:'POST',body:payload('approved')});assert.equal(unavailable.status,409);assert.equal(unavailable.data.error.code,'INSUFFICIENT_STOCK');
    const cartReserved=await other.call('/api/account/cart',{method:'PUT',body:{items:[{variantId:product.variants[0].id,quantity:1}]}});assert.equal(cartReserved.status,422);
    assert.equal((await other.call('/api/products?available=true')).data.pagination.total,0);
    const adjusted=await admin.call('/api/admin/products/'+product.id,{method:'PUT',body:{...product,variants:product.variants.map(v=>({...v,stock:0}))}});assert.equal(adjusted.status,409);assert.equal(adjusted.data.error.code,'STOCK_RESERVED');
  });
  await t.test('cancelamento libera reserva e evento repetido não duplica estoque',async()=>{
    const data={outcome:'cancelled',idempotencyKey:crypto.randomUUID()};
    const cancelled=await customer.call('/api/account/orders/'+pending.id+'/simulate',{method:'POST',body:data});assert.equal(cancelled.status,200,JSON.stringify(cancelled.data));assert.equal(cancelled.data.order.paymentStatus,'CANCELLED');
    assert.equal((await customer.call('/api/account/orders/'+pending.id+'/simulate',{method:'POST',body:data})).status,200);
    assert.equal((await db.prepare("SELECT COUNT(*) n FROM inventory_reservations WHERE order_id=? AND status='ACTIVE'").get(pending.id)).n,0);
    assert.equal((await db.prepare('SELECT stock FROM variants WHERE id=?').get(product.variants[0].id)).stock,1);
  });
  await t.test('aprovação baixa estoque uma vez; snapshots e histórico continuam após edição',async()=>{
    const data=payload('approved'),created=await customer.call('/api/checkout',{method:'POST',body:data});assert.equal(created.status,201,JSON.stringify(created.data));const order=created.data.order;
    assert.equal(order.status,'CONFIRMED');assert.equal(order.paymentStatus,'APPROVED');assert.equal(order.totalCents,11500);assert.equal(order.history.length,2);
    assert.equal((await db.prepare('SELECT stock FROM variants WHERE id=?').get(product.variants[0].id)).stock,0);
    assert.equal((await customer.call('/api/checkout',{method:'POST',body:data})).data.order.id,order.id);
    const update=await admin.call('/api/admin/products/'+product.id,{method:'PUT',body:{...product,name:'Nome alterado',variants:product.variants.map(v=>({...v,priceCents:12000,stock:0}))}});assert.equal(update.status,200);product=update.data;
    const details=await customer.call('/api/account/orders/'+order.id);assert.equal(details.data.items[0].name,'Booster de teste');assert.equal(details.data.items[0].unitPriceCents,10000);
    const ready=await admin.call('/api/admin/orders/'+order.id+'/shipping',{method:'PATCH',body:{status:'READY_TO_SHIP'}});assert.equal(ready.status,200);assert.equal(ready.data.order.shippingStatus,'READY_TO_SHIP');
    const shipping=await admin.call('/api/admin/orders/'+order.id+'/shipping',{method:'PATCH',body:{status:'SHIPPED',trackingCode:'DEMO123',trackingUrl:'https://example.test/rastreio'}});assert.equal(shipping.status,200);assert.equal(shipping.data.order.shippingStatus,'SHIPPED');assert.equal(shipping.data.order.history.length,4);
    assert.equal((await customer.call('/api/admin/orders/'+order.id+'/shipping',{method:'PATCH',body:{status:'DELIVERED'}})).status,403);
    assert.equal((await customer.call('/api/account/orders/'+order.id+'/simulate',{method:'POST',body:{outcome:'cancelled',idempotencyKey:crypto.randomUUID()}})).status,409);
  });
  await t.test('recusa e expiração liberam reservas; variantes e frete grátis usam servidor',async()=>{
    const updated=await admin.call('/api/admin/products/'+product.id,{method:'PUT',body:{...product,variants:product.variants.map(v=>({...v,priceCents:15000,stock:2}))}});assert.equal(updated.status,200);product=updated.data;
    for(const outcome of ['rejected','expired']){
      const created=await customer.call('/api/checkout',{method:'POST',body:payload(outcome)});assert.equal(created.status,201,JSON.stringify(created.data));assert.equal(created.data.order.paymentStatus,outcome.toUpperCase());assert.equal(created.data.order.shippingCents,0);
      assert.equal((await db.prepare('SELECT stock FROM variants WHERE id=?').get(product.variants[0].id)).stock,2);
    }
    const created=await customer.call('/api/checkout',{method:'POST',body:payload()});assert.equal(created.status,201);
    const id=created.data.order.id,payment=await db.prepare('SELECT * FROM payments WHERE order_id=?').get(id),details=JSON.parse(payment.payload_json);details.expiresAt='2020-01-01T00:00:00.000Z';await db.prepare('UPDATE payments SET payload_json=? WHERE id=?').run(JSON.stringify(details),payment.id);
    const expired=await customer.call('/api/account/orders/'+id+'/simulate',{method:'POST',body:{outcome:'approved',idempotencyKey:crypto.randomUUID()}});assert.equal(expired.status,200);assert.equal(expired.data.order.paymentStatus,'EXPIRED');
  });
  if(engine==='sqlite') await t.test('duas compras concorrentes da última unidade produzem apenas um pedido aprovado',async()=>{
    const updated=await admin.call('/api/admin/products/'+product.id,{method:'PUT',body:{...product,variants:product.variants.map(v=>({...v,stock:1}))}});assert.equal(updated.status,200);product=updated.data;
    const results=await Promise.all([customer.call('/api/checkout',{method:'POST',body:payload('approved')}),other.call('/api/checkout',{method:'POST',body:payload('approved')})]);
    assert.deepEqual(results.map(x=>x.status).sort(),[201,409]);assert.equal((await db.prepare('SELECT stock FROM variants WHERE id=?').get(product.variants[0].id)).stock,0);
  });
  await t.test('coleções, banners e prévias privadas são persistidos sem expor token público',async()=>{
    const created=await admin.call('/api/admin/collections',{method:'POST',body:{id:'demo-set',name:'Coleção Demo',aliases:['Demo'],featured:true,image:'/assets/pack.webp'}});assert.equal(created.status,201,JSON.stringify(created.data));
    assert.equal((await customer.call('/api/collections?q=demo')).data.items.length,1);
    assert.equal((await customer.call('/api/config')).data.banners[0].title,'Demonstração');
    const reset=await customer.call('/api/auth/forgot-password',{method:'POST',body:{email:'cliente@example.test'}});assert.equal(reset.status,202);assert.equal(reset.data.token,undefined);
    assert.equal((await customer.call('/api/admin/emails')).status,403);
    const emails=await admin.call('/api/admin/emails');assert.equal(emails.status,200,JSON.stringify(emails.data));assert.ok(emails.data.items.length>=3);assert.ok(emails.data.items.some(x=>x.template==='order-confirmation'));assert.ok(!JSON.stringify(emails.data).includes('password-test'));
    const record=await db.prepare("SELECT payload_json FROM email_outbox WHERE payload_json LIKE '%password-reset%' ORDER BY created_at DESC LIMIT 1").get(),message=JSON.parse(record.payload_json),token=new URL(message.data.resetUrl).searchParams.get('token');
    assert.ok(token);assert.ok(!JSON.stringify(emails.data).includes(token));
    const resetPassword=await other.call('/api/auth/reset-password',{method:'POST',body:{token,password:'NewBuyer1234'}});assert.equal(resetPassword.status,200,JSON.stringify(resetPassword.data));
    assert.equal((await customer.call('/api/account/orders')).status,401);
    assert.equal((await other.call('/api/auth/reset-password',{method:'POST',body:{token,password:'OtherNew1234'}})).status,422);
  });
  if(engine==='postgres') await t.test('migrations PostgreSQL idempotentes e tabelas protegidas por RLS',async()=>{
    const migrations=await db.prepare('SELECT version FROM bkm_migrations ORDER BY version').all();assert.deepEqual(migrations.map(x=>x.version),[1,2,3,4,5,6,7,8,9,10]);
    const rows=await db.prepare("SELECT tablename,rowsecurity FROM pg_tables WHERE schemaname='public'").all();assert.ok(rows.length>=20);assert.ok(rows.every(x=>x.rowsecurity));
  });
});
