const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {once}=require('node:events');
const {createServer}=require('../serve.cjs');
const {hashPassword}=require('../server/auth.cjs');
const {openDatabase}=require('../server/db.cjs');

test('migrations são idempotentes, catálogo comercial inicia vazio e persiste em disco',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bkm-db-')),filename=path.join(dir,'store.sqlite');
  let db;
  try{db=openDatabase(filename);assert.equal(db.prepare('SELECT COUNT(*) n FROM products').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n,0);db.close();db=openDatabase(filename);assert.equal(db.prepare('PRAGMA user_version').get().user_version,9);}finally{db?.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('API integrada: sessões, RBAC, inventário, preços, cupons, frete e privacidade',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bkm-api-'));
  const root=dir,dbPath=path.join(dir,'store.sqlite');
  fs.writeFileSync(path.join(root,'index.html'),'<!doctype html><title>Teste descartável</title>');
  fs.writeFileSync(path.join(root,'app.js'),'/* recurso público de teste */');
  const server=createServer({root,dbPath,databaseUrl:'',env:{BKM_ENVIRONMENT:'demo',PAYMENT_PROVIDER:'disabled',EMAIL_PROVIDER:'development'}});server.listen(0,'127.0.0.1');await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port;
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});});
  class Client{constructor(){this.cookie='';this.csrf='';}async call(route,{method='GET',body,headers={}}={}){const res=await fetch(base+route,{method,headers:{...(this.cookie?{cookie:this.cookie}:{}),...(this.csrf?{'x-csrf-token':this.csrf}:{}),...(body?{'content-type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});const set=res.headers.get('set-cookie');if(set)this.cookie=set.split(';')[0];const type=res.headers.get('content-type')||'';const data=type.includes('json')?await res.json():await res.text();if(data.csrfToken)this.csrf=data.csrfToken;return {res,data,status:res.status};}async session(){return this.call('/api/session');}}
  const anon=new Client(),admin=new Client(),customer=new Client(),outsider=new Client();
  await t.test('sessão HttpOnly, CSRF e origem; cliente nunca se promove admin',async()=>{
    const s=await anon.session();assert.equal(s.data.user,null);assert.match(s.res.headers.get('set-cookie'),/HttpOnly; SameSite=Lax/);assert.equal(s.data.csrfToken.length,43);
    const bad=await anon.call('/api/auth/register',{method:'POST',body:{email:'a@example.test',name:'Ana',password:'Customer1234'},headers:{'x-csrf-token':'bad'}});assert.equal(bad.status,403);assert.equal(bad.data.error.code,'CSRF');
    assert.equal((await anon.call('/api/auth/register',{method:'POST',headers:{origin:'https://evil.example'},body:{}})).status,403);
    await customer.session();const registration=await customer.call('/api/auth/register',{method:'POST',body:{email:'customer@example.test',name:'Cliente',password:'Customer1234',role:'ADMIN'}});assert.equal(registration.status,201);assert.equal(registration.data.user.role,'CUSTOMER');assert.equal((await customer.call('/api/admin/products')).status,403);assert.equal((await anon.call('/api/admin/products')).status,401);
    await outsider.session();assert.equal((await outsider.call('/api/auth/register',{method:'POST',body:{email:'other@example.test',name:'Outro',password:'OtherTest123'}})).status,201);
  });
  const adminId=crypto.randomUUID();server.api.db.prepare("INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)").run(adminId,'admin@example.test','Administrador de teste',await hashPassword('admin-long-password'),'ADMIN',new Date().toISOString());
  await t.test('login rotaciona sessão, valida senha e logout revoga token',async()=>{
    await admin.session();const oldCookie=admin.cookie;const login=await admin.call('/api/auth/login',{method:'POST',body:{email:'admin@example.test',password:'admin-long-password'}});assert.equal(login.status,200);assert.equal(login.data.user.role,'ADMIN');assert.notEqual(admin.cookie,oldCookie);assert.equal(server.api.db.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id=?').get(adminId).n,1);
    const unknown=new Client();await unknown.session();assert.equal((await unknown.call('/api/auth/login',{method:'POST',body:{email:'nobody@example.test',password:'wrong-long-password'}})).status,401);
  });
  let single,sealed;
  const baseProduct={kind:'SINGLE',name:'Pikáchu ex teste',slug:'pikachu-teste',description:'Registro temporário exclusivo dos testes automatizados.',sku:'TEST-PK-025',setId:'test-set',setName:'Coleção teste',images:[{url:'/assets/pikachu.webp',kind:'reference'}],card:{name:'Pikachu ex',number:'025',total:'198',provider:'manual',language:'pt'},featured:true,published:true,variants:[{language:'pt',condition:'NM',finish:'HOLO',priceCents:10000,stock:1},{language:'en',condition:'LP',finish:'HOLO',priceCents:8000,stock:2}]};
  await t.test('CRUD comercial e filtros reais com acentos, zeros e variantes',async()=>{
    const saved=await admin.call('/api/admin/products',{method:'POST',body:baseProduct});assert.equal(saved.status,201,JSON.stringify(saved.data));single=saved.data;assert.equal(single.variants.length,2);assert.equal(single.card.number,'025');
    const box=await admin.call('/api/admin/products',{method:'POST',body:{...baseProduct,kind:'SEALED',name:'ETB teste',slug:'etb-teste',sku:'TEST-ETB',card:null,variants:[{language:'pt',condition:'SEALED',finish:'NORMAL',priceCents:8000,stock:10}]}});assert.equal(box.status,201);sealed=box.data;
    assert.equal((await anon.call('/api/products?kind=SINGLE&set=test-set&q=pikachu%20025&language=pt&condition=NM')).data.items.length,1);
    assert.equal((await anon.call('/api/products?set=another-set')).data.items.length,0);assert.equal((await anon.call('/api/products?kind=SEALED')).data.items.length,1);
    const publicProduct=await anon.call('/api/products/pikachu-teste');assert.equal(publicProduct.status,200);assert.equal(publicProduct.data.images[0].kind,'reference');
    const bad=await admin.call('/api/admin/products',{method:'POST',body:{...baseProduct,sku:'NEGATIVE',slug:'negative',variants:[{language:'pt',priceCents:100,stock:-1}]}});assert.equal(bad.status,422);
    const duplicate=await admin.call('/api/admin/products',{method:'POST',body:baseProduct});assert.equal(duplicate.status,409);
    assert.equal(server.api.db.prepare('SELECT COUNT(*) n FROM products').get().n,2);
  });
  await t.test('cotação ignora preço enviado e agrupa duplicados; estoque não negativo',async()=>{
    const variantId=single.variants[0].id;const q=await anon.call('/api/checkout/quote',{method:'POST',body:{items:[{variantId,quantity:1,priceCents:1}],cep:'01001000'}});assert.equal(q.status,200);assert.equal(q.data.subtotalCents,10000);assert.equal(q.data.totalCents,null);assert.equal(q.data.paymentAvailable,false);
    const excess=await anon.call('/api/checkout/quote',{method:'POST',body:{items:[{variantId,quantity:1},{variantId,quantity:1}]}});assert.equal(excess.status,409);assert.equal(excess.data.error.fields.available,1);
    assert.equal((await anon.call('/api/checkout/quote',{method:'POST',body:{items:[{variantId,quantity:0}]}})).status,422);
  });
  await t.test('IDs de variante duplicados são rejeitados e edição de metadados persiste',async()=>{
    const bad={...single,variants:[single.variants[0],{...single.variants[1],id:single.variants[0].id}]};
    const response=await admin.call('/api/admin/products/'+single.id,{method:'PUT',body:bad});assert.equal(response.status,422);assert.equal(response.data.error.code,'DUPLICATE_VARIANT');
    const updated=await admin.call('/api/admin/products/'+single.id,{method:'PUT',body:{...single,card:{...single.card,rarity:'Ultra Rare',type:'Elétrico'}}});assert.equal(updated.status,200);assert.equal(updated.data.card.rarity,'Ultra Rare');assert.equal((await anon.call('/api/products/pikachu-teste')).data.card.type,'Elétrico');single=updated.data;
  });
  await t.test('carrinho e favoritos persistem na conta e não vazam entre usuários',async()=>{
    const items=[{variantId:single.variants[0].id,quantity:1}];const response=await customer.call('/api/account/cart',{method:'PUT',body:{items}});assert.equal(response.status,200);assert.deepEqual((await customer.call('/api/account/cart')).data.items,items);assert.deepEqual((await outsider.call('/api/account/cart')).data.items,[]);
    assert.equal((await customer.call('/api/account/cart',{method:'PUT',body:{items:[{variantId:single.variants[0].id,quantity:2}]}})).status,422);assert.deepEqual((await customer.call('/api/account/cart')).data.items,items);
    assert.equal((await customer.call('/api/account/favorites',{method:'PUT',body:{items:[single.id,single.id]}})).status,200);assert.deepEqual((await customer.call('/api/account/favorites')).data.items,[single.id]);assert.deepEqual((await outsider.call('/api/account/favorites')).data.items,[]);assert.equal((await anon.call('/api/account/cart')).status,401);
  });
  await t.test('frete grátis usa configuração, subtotal após cupom e CEP elegível',async()=>{
    const update=await admin.call('/api/admin/settings',{method:'PUT',body:{shipping:{enabled:true,flatRateCents:2000,estimatedDays:5,freeShippingEnabled:true,freeShippingThresholdCents:15000,regions:[{start:'01000000',end:'09999999'}]}}});assert.equal(update.status,200);
    const items=[{variantId:single.variants[0].id,quantity:1},{variantId:sealed.variants[0].id,quantity:1}];
    let q=await anon.call('/api/checkout/quote',{method:'POST',body:{items,cep:'01001-000'}});assert.equal(q.data.subtotalCents,18000);assert.equal(q.data.shippingCents,0);assert.equal(q.data.totalCents,18000);
    const coupon=await admin.call('/api/admin/coupons',{method:'POST',body:{code:'TESTE20',type:'PERCENT',value:20,active:true}});assert.equal(coupon.status,201);
    q=await anon.call('/api/checkout/quote',{method:'POST',body:{items,cep:'01001000',coupon:'teste20'}});assert.equal(q.data.discountCents,3600);assert.equal(q.data.shippingCents,2000);assert.equal(q.data.totalCents,16400);assert.equal(q.data.shipping.remainingForFreeShippingCents,600);
    assert.equal((await anon.call('/api/checkout/quote',{method:'POST',body:{items,cep:'20000000'}})).data.shipping.available,false);
    const current=(await admin.call('/api/admin/settings')).data;current.shipping.freeShippingThresholdCents=25000;await admin.call('/api/admin/settings',{method:'PUT',body:current});q=await anon.call('/api/checkout/quote',{method:'POST',body:{items,cep:'01001000'}});assert.equal(q.data.shippingCents,2000);assert.equal(q.data.shipping.remainingForFreeShippingCents,7000);
    const expired=await admin.call('/api/admin/coupons',{method:'POST',body:{code:'EXPIRED',type:'FIXED',value:1000,endsAt:'2020-01-01T00:00:00Z'}});assert.equal(expired.status,201);assert.equal((await anon.call('/api/checkout/quote',{method:'POST',body:{items,coupon:'EXPIRED'}})).status,422);
  });
  await t.test('variante desativada fica fora da loja; edição registra estoque e preserva IDs',async()=>{
    const changed={...single,variants:single.variants.map(v=>({...v,stock:v.language==='pt'?0:v.stock}))};const result=await admin.call('/api/admin/products/'+single.id,{method:'PUT',body:changed});assert.equal(result.status,200);assert.equal(result.data.variants[0].id,single.variants[0].id);assert.equal((await anon.call('/api/products?available=true&language=pt&condition=NM')).data.items.length,0);assert.ok(server.api.db.prepare('SELECT COUNT(*) n FROM stock_movements').get().n>=4);single=result.data;
  });
  await t.test('pagamento indisponível nunca cria pedido ou reserva fictícia',async()=>{
    const before=server.api.db.prepare('SELECT COUNT(*) n FROM orders').get().n;const response=await customer.call('/api/checkout',{method:'POST',body:{items:[{variantId:sealed.variants[0].id,quantity:1}],cep:'01001000',totalCents:1}});assert.equal(response.status,503);assert.equal(response.data.error.code,'PAYMENT_UNAVAILABLE');assert.equal(server.api.db.prepare('SELECT COUNT(*) n FROM orders').get().n,before);assert.equal(server.api.db.prepare('SELECT COUNT(*) n FROM inventory_reservations').get().n,0);
    assert.equal((await customer.call('/api/account/orders')).data.items.length,0);assert.equal((await outsider.call('/api/account/orders/not-theirs')).status,404);
  });
  await t.test('pedido registrado só pode ser consultado pelo próprio cliente ou admin',async()=>{
    const customerId=(await customer.call('/api/session')).data.user.id,id=crypto.randomUUID(),stamp=new Date().toISOString();
    server.api.db.prepare("INSERT INTO orders(id,user_id,status,payment_status,shipping_status,currency,subtotal_cents,discount_cents,shipping_cents,total_cents,coupon_id,address_json,payment_provider_id,idempotency_key,created_at,updated_at) VALUES(?,?, 'PENDING','PENDING','UNFULFILLED','BRL',8000,0,2000,10000,NULL,?,NULL,?,?,?)").run(id,customerId,JSON.stringify({postalCode:'01001000'}),'test-only-'+id,stamp,stamp);
    assert.equal((await customer.call('/api/account/orders/'+id)).status,200);assert.equal((await outsider.call('/api/account/orders/'+id)).status,404);assert.equal((await admin.call('/api/admin/orders')).data.items.length,1);
  });
  await t.test('servidor não expõe arquivos privados, uploads executáveis nem URLs indevidas',async()=>{
    for(const url of ['/server/api.cjs','/data/bkm.sqlite','/.env','/package.json','/scripts/create-admin.cjs','/tests/backend.test.cjs'])assert.equal((await anon.call(url)).status,404,url);
    assert.equal((await anon.call('/cartas')).status,200);assert.equal((await anon.call('/app.js')).status,200);
    const invalid=await admin.call('/api/admin/uploads',{method:'POST',body:{dataUrl:'data:image/svg+xml;base64,PHN2Zy8+'}});assert.equal(invalid.status,422);
    const fakePng=await admin.call('/api/admin/uploads',{method:'POST',body:{dataUrl:'data:image/png;base64,'+Buffer.from('this is not an image').toString('base64')}});assert.equal(fakePng.status,422);
    const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jIiwAAAAASUVORK5CYII=';
    const uploaded=await admin.call('/api/admin/uploads',{method:'POST',body:{dataUrl:'data:image/png;base64,'+png}});assert.equal(uploaded.status,201);assert.match(uploaded.data.url,/^\/uploads\/[a-f0-9-]+\.png$/);const read=await fetch(base+uploaded.data.url);assert.equal(read.status,200);assert.equal(read.headers.get('content-type'),'image/png');
    const unsafe=await admin.call('/api/admin/products',{method:'POST',body:{...baseProduct,slug:'unsafe',sku:'UNSAFE',images:[{url:'javascript:alert(1)'}]}});assert.equal(unsafe.status,422);
  });
  await t.test('painel agrega todo o inventário além da primeira página; políticas e endereço persistem',async()=>{
    for(let i=0;i<49;i++){
      const added=await admin.call('/api/admin/products',{method:'POST',body:{...baseProduct,kind:'SEALED',name:'Rascunho de teste '+i,slug:'draft-test-'+i,sku:'DRAFT-'+i,card:null,published:false,variants:[{language:'pt',condition:'SEALED',finish:'NORMAL',priceCents:100,stock:1}]}});
      assert.equal(added.status,201);
    }
    const firstPage=await admin.call('/api/admin/products?pageSize=48');
    assert.equal(firstPage.data.items.length,48);assert.equal(firstPage.data.pagination.total,51);
    const summary=(await admin.call('/api/admin/summary')).data;
    assert.equal(summary.products,51);assert.equal(summary.published,2);assert.equal(summary.stockUnits,61);
    const settings={address:'Endereço sintético de teste',privacyPolicy:'Política de teste\nSomente no banco temporário.',shippingPolicy:'Envio de teste'};
    assert.equal((await admin.call('/api/admin/settings',{method:'PUT',body:settings})).status,200);
    const config=(await anon.call('/api/config')).data;
    assert.equal(config.address,settings.address);assert.equal(config.privacyPolicy,settings.privacyPolicy);assert.equal(config.shippingPolicy,settings.shippingPolicy);
  });
  await t.test('arquivamento preserva registro e logout invalida sessão autenticada',async()=>{
    assert.equal((await admin.call('/api/admin/products/'+single.id,{method:'DELETE'})).status,200);assert.equal((await anon.call('/api/products/pikachu-teste')).status,404);assert.ok(server.api.db.prepare('SELECT id FROM products WHERE id=?').get(single.id));
    const old=admin.cookie;await admin.call('/api/auth/logout',{method:'POST',body:{}});assert.equal((await admin.call('/api/admin/products')).status,401);const replay=new Client();replay.cookie=old;assert.equal((await replay.call('/api/admin/products')).status,401);
  });
});
