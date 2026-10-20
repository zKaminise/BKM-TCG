const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {openStore,migratePostgres}=require('../server/store.cjs');
const {createPersonalCollection}=require('../server/personal-collection.cjs');
const {parsePersonalCsv,exportPersonalCsv}=require('../server/personal-csv.cjs');
class ApiError extends Error {constructor(status,code,message){super(message);Object.assign(this,{status,code});}}

async function fixture(t,engine) {
  let pg;const pgClient=engine==='postgres'?(pg=new PGlite(),{query:async(sql,args)=>args?.length?pg.query(sql,args):(await pg.exec(sql)).at(-1),end:()=>pg.close()}):undefined;
  const db=openStore({dbPath:':memory:',pgClient,env:{}});await db.ready;t.after(()=>db.close());
  let clock=Date.parse('2026-10-01T10:00:00Z'),online=true;const calls=[];
  const cards=[{id:'test1-001',name:'Pikachu',localId:'001',rarity:'Rare',image:'https://assets.tcgdex.net/pt/test/test1/001',set:{id:'test1'},variants:{normal:true,holo:true,reverse:true}},{id:'test1-002',name:'Bulbasaur',localId:'002',rarity:'Common',image:'https://assets.tcgdex.net/pt/test/test1/002',set:{id:'test1'},variants:{normal:true,reverse:true}},{id:'test1-003',name:'Carta secreta',localId:'003',rarity:'Secret',image:'https://assets.tcgdex.net/pt/test/test1/003',set:{id:'test1'},variants:{holo:true}}];
  const set={id:'test1',name:'Coleção teste',logo:'https://assets.tcgdex.net/pt/test/test1/logo',serie:{name:'Série teste'},cardCount:{official:2,total:3},cards:cards.map(({id,name,localId,image})=>({id,name,localId,image}))};
  const fetchImpl=async url=>{assert.equal(new URL(url).hostname,'api.tcgdex.net');calls.push(String(url));if(!online)throw new Error('Provider offline');const path=new URL(url).pathname.split('/').slice(3).join('/');let data=path==='sets'?[{...set,cards:undefined}]:path==='sets/test1'?set:path.startsWith('cards/')?cards.find(card=>card.id===path.slice(6)):null;return {ok:!!data,status:data?200:404,text:async()=>JSON.stringify(data)};};
  const service=createPersonalCollection({db,ApiError,fetchImpl,now:()=>clock});
  const alice={id:crypto.randomUUID()},bob={id:crypto.randomUUID()};
  for(const [user,name]of[[alice,'Alice'],[bob,'Bob']])await db.prepare("INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,'test$unusable','CUSTOMER',?)").run(user.id,name.toLowerCase()+'@example.test',name,new Date(clock).toISOString());
  const call=async(user,method,route,body={},search='')=>(await service.handle({user,method,path:'/api/account/collection'+route,query:new URLSearchParams(search),body})).data;
  return {db,pgClient,service,alice,bob,call,calls,advance:ms=>clock+=ms,offline:()=>online=false,now:()=>clock,cards};
}

for(const engine of ['sqlite','postgres'])test('Coleção pessoal privada e persistente: '+engine,async t=>{
  const f=await fixture(t,engine),{db,alice,bob,call}=f;
  await t.test('autorização, catálogo real simulado no transporte, cache compartilhado sem dados pessoais',async()=>{
    await assert.rejects(call(null,'GET','/summary'),error=>error.status===401);
    assert.equal(await f.service.handle({path:'/api/products',method:'GET'}),null);
    const catalog=await call(alice,'GET','/catalog/sets',{},'language=pt&q=colecao');assert.equal(catalog.items.length,1);assert.equal(catalog.source,'TCGdex');
    const initial=f.calls.length;await call(bob,'GET','/catalog/sets',{},'language=pt');assert.equal(f.calls.length,initial);
    await assert.rejects(call(alice,'POST','/sets',{setId:'https://outside.invalid',language:'pt'}),error=>error.status===422);
  });
  let setId,firstLot,secondLot,wishId;
  await t.test('checklist básico, lotes distintos, duplicatas, variantes e custo unitário',async()=>{
    const set=await call(alice,'POST','/sets',{setId:'test1',language:'pt'});setId=set.id;assert.equal(set.totalCards,2);assert.equal(set.missingCards,2);
    const duplicate=await call(alice,'POST','/sets',{setId:'test1',language:'pt'});assert.equal(duplicate.id,setId);
    firstLot=await call(alice,'POST','/items',{cardId:'test1-001',setId:'test1',language:'pt',quantity:2,condition:'NM',variant:'HOLO',paidCents:100,acquiredAt:'2025-01-01',notes:'Unidades NM'});
    secondLot=await call(alice,'POST','/items',{cardId:'tcgdex:pt:test1-001',setId:'test1',language:'pt',quantity:1,condition:'LP',variant:'NORMAL',paidCents:200});
    assert.notEqual(firstLot.id,secondLot.id);assert.equal(firstLot.card.number,'001');
    const summary=await call(alice,'GET','/summary');assert.equal(summary.totals.quantity,3);assert.equal(summary.totals.uniqueCards,1);assert.equal(summary.totals.paidCents,400);assert.equal(summary.totals.unpricedQuantity,3);assert.equal(summary.sets[0].completionPercent,50);
    assert.equal((await call(alice,'GET','/items',{},'q=pikachu&pageSize=1&page=2')).items.length,1);
    assert.equal((await call(alice,'GET','/items',{},'condition=LP')).items[0].id,secondLot.id);
    assert.equal((await call(alice,'GET','/sets/'+setId,{},'state=missing')).items[0].id,'test1-002');
    await call(alice,'PUT','/sets/'+setId,{goal:{mode:'custom',includeSecrets:true,variants:['NORMAL','HOLO']}});
    const custom=await call(alice,'GET','/sets/'+setId);assert.equal(custom.collection.totalCards,3);assert.equal(custom.collection.requiredTargets,6);assert.equal(custom.collection.ownedTargets,2);
    await assert.rejects(call(alice,'POST','/items',{cardId:'test1-001',setId:'other',quantity:1}),error=>error.status===422);
    await assert.rejects(call(alice,'POST','/items',{cardId:'test1-001',setId:'test1',quantity:-1}),error=>error.status===422);
    await assert.rejects(call(alice,'POST','/items',{cardId:'test1-001',setId:'test1',quantity:1,photoUrl:'javascript:alert(1)'}),error=>error.status===422);
  });
  await t.test('ownership impede IDOR inclusive admin e payload não escolhe proprietário',async()=>{
    await assert.rejects(call(bob,'GET','/sets/'+setId),error=>error.status===404);
    await assert.rejects(call(bob,'PUT','/items/'+firstLot.id,{quantity:9,userId:alice.id}),error=>error.status===404);
    await assert.rejects(call(bob,'DELETE','/items/'+firstLot.id),error=>error.status===404);
    await assert.rejects(call({...bob,role:'ADMIN'},'GET','/sets/'+setId),error=>error.status===404);
    assert.equal((await call(bob,'GET','/items')).total,0);assert.equal((await call(bob,'GET','/summary')).totals.quantity,0);
  });
  await t.test('cotações privadas BRL, fonte manual honesta, custos, histórico e ausência de preço',async()=>{
    const quote=await call(alice,'POST','/prices',{cardId:'test1-001',setId:'test1',language:'pt',condition:'NM',variant:'HOLO',valueCents:1500,source:'Liga Pokémon oficial',sourceLabel:'Referência informada',sourceUrl:'https://example.test/reference'});
    assert.equal(quote.source,'user_manual');assert.equal(quote.methodology,'manual');assert.equal(quote.coverage,'user_reported');
    const summary=await call(alice,'GET','/summary');assert.equal(summary.totals.estimatedValueCents,3000);assert.equal(summary.totals.knownValueQuantity,2);assert.equal(summary.totals.unpricedQuantity,1);assert.equal(summary.totals.partial,true);assert.ok(summary.history.length>=1);
    assert.equal((await call(bob,'GET','/prices')).total,0);
    await assert.rejects(call(alice,'POST','/prices',{cardId:'test1-001',setId:'test1',valueCents:100,currency:'USD'}),error=>error.status===422);
    await assert.rejects(call(alice,'POST','/prices/refresh',{cardId:'test1-001',setId:'test1'}),error=>error.code==='PRICE_PROVIDER_UNAVAILABLE');
    f.advance(8*86400000);const stale=await call(alice,'GET','/summary');assert.equal(stale.totals.estimatedValueCents,0);assert.equal(stale.totals.staleQuantity,2);assert.equal(stale.totals.unpricedQuantity,3);assert.ok(stale.history.length>=2);
    assert.equal((await call(alice,'GET','/prices')).items[0].stale,true);
  });
  let productId,variantId;
  await t.test('wishlist referencia cartas sem anúncios e só combina publicação, estoque e preferências exatas',async()=>{
    const wanted=await call(alice,'POST','/wishlist',{cardId:'test1-001',setId:'test1',language:'pt',preferences:{languages:['pt'],conditions:['NM'],variants:['HOLO'],maxPriceCents:2000,notifyEmail:true}});wishId=wanted.id;assert.equal(wanted.offers.length,0);
    productId=crypto.randomUUID();variantId=crypto.randomUUID();const metadataId=crypto.randomUUID(),time=new Date(f.now()).toISOString();
    await db.prepare('INSERT INTO card_metadata(id,identity_key,tcg,set_id,number,language,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?)').run(metadataId,'fixture/pikachu','pokemon','test1','001','pt',JSON.stringify({provider:'tcgdex',providerId:'test1-001',number:'001'}),time);
    await db.prepare("INSERT INTO products(id,slug,kind,name,description,sku,tcg,set_id,set_name,card_id,images_json,attributes_json,search_text,published,created_at,updated_at) VALUES(?,?,'SINGLE',?,'fixture',?,'pokemon','test1','Coleção teste',?,'[]','{}','pikachu',0,?,?)").run(productId,'fixture-pikachu','Pikachu fixture','FIXTURE-'+productId,metadataId,time,time);
    await db.prepare('INSERT INTO variants(id,product_id,language,condition,finish,price_cents,stock) VALUES(?,?,?,?,?,?,?)').run(variantId,productId,'pt','NM','HOLO',1500,1);
    assert.equal((await call(alice,'GET','/wishlist')).items[0].offers.length,0);
    await db.prepare('UPDATE products SET published=1 WHERE id=?').run(productId);
    assert.equal((await call(alice,'GET','/wishlist')).items[0].offers.length,1);
    await db.prepare("UPDATE variants SET language='en' WHERE id=?").run(variantId);assert.equal((await call(alice,'GET','/wishlist')).items[0].offers.length,0);
    await db.prepare("UPDATE variants SET language='pt',condition='LP' WHERE id=?").run(variantId);assert.equal((await call(alice,'GET','/wishlist')).items[0].offers.length,0);
    await db.prepare("UPDATE variants SET condition='NM',price_cents=3000 WHERE id=?").run(variantId);assert.equal((await call(alice,'GET','/wishlist')).items[0].offers.length,0);
    await db.prepare('UPDATE variants SET price_cents=1500 WHERE id=?').run(variantId);
    await assert.rejects(call(bob,'DELETE','/wishlist/'+wishId),error=>error.status===404);
    await assert.rejects(call(alice,'PUT','/wishlist/'+wishId,{cardId:'test1-002'}),error=>error.status===422);
  });
  await t.test('alertas in-app deduplicados, consentimento duplo para email e estoque reservado indisponível',async()=>{
    assert.equal((await f.service.eligibleWishlistRecipients(productId)).length,0);
    await call(alice,'PUT','/preferences',{notifyEmail:true});const recipients=await f.service.onInventoryChange(productId,'publication-one');assert.equal(recipients.length,1);assert.equal(recipients[0].userId,alice.id);assert.equal(recipients[0].items[0].variantId,variantId);
    const first=await call(alice,'GET','/notifications');await f.service.onInventoryChange(productId,'publication-one');await f.service.onInventoryChange(productId,'unrelated-update');const again=await call(alice,'GET','/notifications');assert.equal(again.total,first.total);assert.equal(again.total,1);
    assert.deepEqual(await f.service.onInventoryChange(productId,'description-only'),[]);
    await call(alice,'GET','/wishlist');await call(alice,'GET','/wishlist');assert.equal((await call(alice,'GET','/notifications')).total,1);
    await db.prepare('UPDATE variants SET stock=0 WHERE id=?').run(variantId);assert.deepEqual(await f.service.onInventoryChange(productId,'sold-out'),[]);assert.equal((await call(alice,'GET','/wishlist')).items[0].offers.length,0);
    await db.prepare('UPDATE variants SET stock=1 WHERE id=?').run(variantId);const restock=await f.service.onInventoryChange(productId,'restock-two');assert.equal(restock.length,1);assert.equal(restock[0].items[0].variantId,variantId);
    assert.equal((await call(alice,'GET','/notifications')).total,2);assert.deepEqual(await f.service.onInventoryChange(productId,'restock-two'),[]);assert.deepEqual(await f.service.onInventoryChange(productId,'new-description'),[]);
    await call(alice,'PUT','/wishlist/'+wishId,{preferences:{_availability:{[variantId]:{available:false,generation:99}}}});
    const publicWish=(await call(alice,'GET','/wishlist')).items[0];assert.equal(publicWish.preferences._availability,undefined);assert.equal((await call(alice,'GET','/notifications')).total,2);
    await assert.rejects(call(bob,'PUT','/notifications/'+again.items[0].id),error=>error.status===404);
    const orderId=crypto.randomUUID(),time=new Date(f.now()).toISOString();await db.prepare("INSERT INTO orders(id,user_id,status,payment_status,shipping_status,currency,subtotal_cents,discount_cents,shipping_cents,total_cents,address_json,idempotency_key,created_at,updated_at) VALUES(?,?,'PENDING','PENDING','PENDING','BRL',1500,0,0,1500,'{}',?,?,?)").run(orderId,alice.id,'fixture/'+orderId,time,time);
    await db.prepare("INSERT INTO inventory_reservations(id,variant_id,order_id,quantity,status,expires_at,created_at) VALUES(?,?,?,1,'ACTIVE',?,?)").run(crypto.randomUUID(),variantId,orderId,f.now()+60000,time);
    assert.equal((await call(alice,'GET','/wishlist')).items[0].offers.length,0);assert.equal((await f.service.eligibleWishlistRecipients(productId)).length,0);
    await call(alice,'PUT','/preferences',{notifyEmail:false});assert.equal((await f.service.eligibleWishlistRecipients(productId)).length,0);
    const prefs=await call(alice,'GET','/preferences');assert.equal(prefs.marketing,false);assert.equal(prefs.abandonedCart,false);assert.ok(prefs.consent.updatedAt);
  });
  await t.test('CSV prévia/confirmar sem importação parcial, consolidação explícita, idempotência e export seguro',async()=>{
    const csv='setId,cardId,language,condition,variant,quantity,paidCents,notes\n'+'test1,test1-002,pt,NM,NORMAL,2,100,"=SUM(A1:A2)"\n'+'test1,test1-002,pt,NM,NORMAL,3,100,"=SUM(A1:A2)"';
    const preview=await call(alice,'POST','/import/preview',{csv});assert.equal(preview.rows.length,2);assert.equal(preview.duplicates.length,1);assert.equal(preview.canConfirm,true);
    await assert.rejects(call(bob,'POST','/import/confirm',{token:preview.token}),error=>error.status===404);
    const imported=await call(alice,'POST','/import/confirm',{token:preview.token,consolidate:true});assert.equal(imported.imported,2);assert.equal(imported.lotIds.length,1);
    assert.deepEqual(await call(alice,'POST','/import/confirm',{token:preview.token,consolidate:true}),imported);
    assert.equal((await call(alice,'GET','/items',{},'cardId=test1-002')).items[0].quantity,5);
    const bad=await call(alice,'POST','/import/preview',{csv:'setId,cardId,quantity\ntest1,test1-002,-1'});assert.equal(bad.canConfirm,false);await assert.rejects(call(alice,'POST','/import/confirm',{token:bad.token}),error=>error.status===422);
    const exported=await call(alice,'GET','/export');assert.ok(exported.csv.includes("'=SUM(A1:A2)"));assert.ok(exported.csv.includes('estimatedValueCents'));assert.match(exported.filename,/\.csv$/);
  });
  await t.test('cadastro em lote atômico e importação de 500 linhas usam SQL agrupado sem consultas por linha',async()=>{
    const base={setId:'test1',cardId:'test1-002',language:'pt',condition:'NM',variant:'NORMAL',quantity:1};
    await assert.rejects(call(bob,'POST','/items/batch',{items:[base,{...base,quantity:-1}]}),error=>error.status===422);
    assert.equal((await call(bob,'GET','/items')).total,0);
    const before=f.calls.length,batch=await call(bob,'POST','/items/batch',{items:[base,{...base,quantity:2}]});assert.equal(batch.items.length,2);assert.equal(f.calls.length,before);
    const original=db.prepare;let queries=0;db.prepare=function(sql){queries++;return original.call(db,sql);};
    try {
      const csv='setId,cardId,quantity,notes\n'+Array.from({length:500},(_,index)=>'test1,test1-002,1,unidade-'+index).join('\n');
      const preview=await call(alice,'POST','/import/preview',{csv});assert.equal(preview.rows.length,500);assert.equal(preview.errors.length,0);assert.ok(queries<15,'Prévia deve conferir referências por grupo.');
      queries=0;const imported=await call(alice,'POST','/import/confirm',{token:preview.token});assert.equal(imported.lotIds.length,500);assert.ok(queries<20,'Confirmação deve inserir grupos de linhas.');
    } finally {db.prepare=original;}
    const preferences=await call(alice,'PUT','/preferences',{digest:'weekly',priceAlerts:true,marketing:false});assert.equal(preferences.digest,'weekly');assert.equal(preferences.priceAlerts,true);
  });
  await t.test('cache vencido usa referência anterior na falha e migrações são aditivas e idempotentes',async()=>{
    f.offline();f.advance(25*3600000);const catalog=await call(alice,'GET','/catalog/sets',{},'language=pt');assert.equal(catalog.stale,true);
    const saved=await call(alice,'GET','/items');assert.ok(saved.total>=3);
    if(engine==='postgres'){await migratePostgres(f.pgClient);const tables=await db.prepare("SELECT tablename,rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'personal_%'").all();assert.equal(tables.length,9);assert.ok(tables.every(table=>table.rowsecurity));}
  });
});

test('CSV pessoal RFC4180, datas inválidas, limites e fórmulas não executáveis',()=>{
  const result=parsePersonalCsv('\ufeffsetId;number;quantity;notes\r\ntest1;001;2;"linha 1\nlinha ""2"""\r\n');assert.equal(result.rows[0].cardId,'test1-001');assert.equal(result.rows[0].notes,'linha 1\nlinha "2"');assert.equal(result.errors.length,0);
  assert.ok(parsePersonalCsv('setId,cardId,acquiredAt\ntest1,test1-001,2026-99-99').errors.length);
  assert.ok(parsePersonalCsv('setId,cardId\ntest1,"not closed').errors.length);
  assert.ok(parsePersonalCsv('setId,cardId\n'+Array(501).fill('test1,test1-001').join('\n')).errors.length);
  for(const value of ['=1+1','+cmd','-cmd','@cmd','\tcommand','\rcommand'])assert.ok(exportPersonalCsv([{notes:value}]).includes("'"+value));
});
