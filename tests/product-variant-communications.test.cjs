'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {openStore}=require('../server/store.cjs');
const {renderEmail}=require('../server/email.cjs');
const {createEmailStore}=require('../server/email-store.cjs');
const {createEmailNotifications}=require('../server/email-notifications.cjs');
const {createPersonalCollection}=require('../server/personal-collection.cjs');
const env={BKM_ENVIRONMENT:'demo',BKM_PUBLIC_URL:'https://bkm.example.test'};
class ApiError extends Error{constructor(status,code,message){super(message);Object.assign(this,{status,code});}}

test('e-mails de pedido exibem identidade imutável da variante, idioma e atributos sem confiar na versão atual do anúncio',()=>{
  const item={name:'Carta <física>',quantity:2,priceCents:1000,language:'en',condition:'D',finish:'NORMAL',attributes:['STAMP'],variant:{language:'zh-tw',condition:'SP',finish:'MASTER_BALL',attributes:['PROMO','FIRST_EDITION']}};
  for(const template of ['order-confirmation','payment-pending','payment-approved','order-preparing','admin-order-paid','order-ready-to-ship','order-shipped']){
    const output=renderEmail(template,{orderId:'immutable-order',orderNumber:'BKM-1',items:[item],subtotalCents:2000,totalCents:2000},{env});
    for(const value of ['Chinês tradicional','Slightly Played (SP)','Master Ball','Promocional','1ª edição']){assert.ok(output.html.includes(value),template+' html '+value);assert.ok(output.text.includes(value),template+' text '+value);}
    assert.match(output.html,/Carta &lt;física&gt;/);assert.doesNotMatch(output.html,/<física>/);assert.doesNotMatch(output.text,/Inglês|Danificada|Carimbo/);assert.ok(!output.text.includes('\\n'),'texto deve conter linhas reais');
  }
  const old=renderEmail('order-confirmation',{items:[{name:'Legado',quantity:1,priceCents:1000}],totalCents:1000},{env});assert.match(old.text,/Legado × 1/);
});

for(const engine of ['sqlite','postgres'])test('desejos e envio de alertas não confundem cópia comum com promo/carimbo: '+engine,async t=>{
  let pg;const pgClient=engine==='postgres'?(pg=new PGlite(),{query:async(sql,args)=>args?.length?pg.query(sql,args):(await pg.exec(sql)).at(-1),end:()=>pg.close()}):undefined;
  const db=openStore({dbPath:':memory:',pgClient,env:{}});await db.ready;t.after(()=>db.close());
  const stamp=new Date().toISOString(),owner=crypto.randomUUID(),productId=crypto.randomUUID(),metadataId=crypto.randomUUID(),normalId=crypto.randomUUID(),promoId=crypto.randomUUID(),wishId=crypto.randomUUID(),email='wishlist-'+owner+'@example.test';
  await db.prepare("INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,'Colecionador','unusable-fixture','CUSTOMER',?)").run(owner,email,stamp);
  await db.prepare('INSERT INTO personal_preferences VALUES(?,?,?)').run(owner,JSON.stringify({notifyEmail:true}),stamp);
  await db.prepare("INSERT INTO card_metadata VALUES(?,?,'pokemon','fixture','001','pt',?,?)").run(metadataId,metadataId,JSON.stringify({providerId:'fixture-001',number:'001'}),stamp);
  await db.prepare("INSERT INTO products(id,slug,kind,name,description,sku,tcg,set_id,set_name,card_id,images_json,attributes_json,search_text,published,created_at,updated_at) VALUES(?,?,'SINGLE','Carta física','Fixture',?,'pokemon','fixture','Coleção fixture',?,'[]','{}','fixture',1,?,?)").run(productId,'card-'+productId,'SKU-'+productId,metadataId,stamp,stamp);
  for(const [id,attributes]of[[normalId,[]],[promoId,['PROMO']]]){
    await db.prepare("INSERT INTO variants(id,product_id,language,condition,finish,price_cents,compare_at_cents,stock,active) VALUES(?,?,'pt','NM','HOLO',1000,NULL,3,1)").run(id,productId);
    await db.prepare("INSERT INTO variant_metadata(variant_id,product_id,identity_key,attributes_json,active) VALUES(?,?,?,?,1)").run(id,productId,'pt|NM|HOLO|'+JSON.stringify(attributes),JSON.stringify(attributes));
  }
  const preferences={notifyEmail:true,languages:['pt'],conditions:['NM'],variants:['HOLO'],flexible:true};
  await db.prepare("INSERT INTO personal_wishlist(id,user_id,set_id,card_id,reference_language,preferences_json,metadata_json,enabled,created_at,updated_at) VALUES(?,?,'fixture','fixture-001','pt',?,?,1,?,?)").run(wishId,owner,JSON.stringify(preferences),JSON.stringify({id:'fixture-001',number:'001',setId:'fixture'}),stamp,stamp);
  const store=createEmailStore(db),notifications=createEmailNotifications({db,emailStore:store,env});await notifications.setPreferences(owner,{wishlistEnabled:true});
  const items=[normalId,promoId].map(variantId=>({productId,variantId})),proof={userId:owner,wishlistIds:[wishId],items};
  assert.deepEqual((await store.currentWishlistItems(proof)).map(item=>item.variantId),[normalId]);
  assert.deepEqual((await store.eligibleWishlistItems(proof)).map(item=>item.variantId),[normalId]);
  const current=(await store.currentWishlistItems(proof))[0];assert.deepEqual(current.attributes,[]);
  const message={template:'wishlist-available',to:email,data:{notificationUserId:owner,consentVerified:true,wishlistIds:[wishId],items:[current]}};assert.equal(await store.notificationAllowed(message),true);
  assert.equal((await store.eligibleWishlistItems({...proof,items:[{...current,attributes:['PROMO']}]})).length,0,'não permite anunciar atributos forjados no payload');
  let externalCalls=0;const service=createPersonalCollection({db,ApiError,fetchImpl:async()=>{externalCalls++;throw Error('No external lookups expected');}});
  const list=async()=>(await service.handle({user:{id:owner},method:'GET',path:'/api/account/collection/wishlist',query:new URLSearchParams()})).data;
  const before=await list();assert.deepEqual(before.items[0].offers.map(row=>row.variantId),[normalId]);assert.deepEqual(before.items[0].offers[0].attributes,[]);
  await db.prepare('UPDATE variant_metadata SET attributes_json=?,identity_key=? WHERE variant_id=?').run('["STAMP"]','pt|NM|HOLO|["STAMP"]',normalId);
  assert.equal((await list()).items[0].offers.length,0);assert.equal((await store.currentWishlistItems(proof)).length,0);assert.equal(await store.notificationAllowed(message),false,'alerta enfileirado é revogado se a versão passa a ser especial');
  await db.prepare('UPDATE variant_metadata SET attributes_json=? WHERE variant_id=?').run('{}',normalId);assert.equal((await store.eligibleWishlistItems(proof)).length,0,'metadado corrompido falha fechado');
  await db.prepare('DELETE FROM variant_metadata WHERE variant_id=?').run(normalId);assert.deepEqual((await store.currentWishlistItems(proof)).map(item=>item.variantId),[normalId],'registro legado sem metadado continua cópia comum');
  assert.equal(externalCalls,0);
});
