const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {once}=require('node:events'),{PGlite}=require('@electric-sql/pglite');
const {createServer}=require('../serve.cjs'),{hashPassword}=require('../server/auth.cjs'),{openDatabase}=require('../server/db.cjs');
const {DatabaseSync}=require('node:sqlite');
async function fixture(t,engine='sqlite'){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bkm-product-editor-'));let pgClient,tail=Promise.resolve();
  if(engine==='postgres'){
    const pg=new PGlite(),direct=async(sql,args)=>args?.length?pg.query(sql,args):(await pg.exec(sql)).at(-1);
    const acquire=async()=>{let release;const previous=tail;tail=new Promise(resolve=>{release=resolve;});await previous;return release;};
    pgClient={connect:async()=>{const release=await acquire();return{query:direct,release};},query:async(...args)=>{const release=await acquire();try{return await direct(...args);}finally{release();}},end:()=>pg.close()};
  }
  let unavailable=false,externalCalls=0;
  const set={id:'fixture151',name:'Coleção de referência',cardCount:{official:165,total:170},serie:{id:'sv',name:'Escarlate e Violeta'},cards:[{id:'fixture151-166',localId:'166',name:'Bulbasaur'},{id:'fixture151-170',localId:'170',name:'Squirtle'}]};
  const providerFetch=async input=>{externalCalls++;if(unavailable)throw Error('Controlled provider outage');const u=new URL(input),parts=u.pathname.split('/').filter(Boolean),[language,resource,id]=parts.slice(1);let body;if(resource==='series')body=[{id:'sv',name:'Escarlate e Violeta'}];else if(resource==='sets'&&!id)body=[set];else if(resource==='sets'&&id===set.id)body=set;else if(resource==='cards'&&!id)body=set.cards;else if(resource==='cards'&&set.cards.some(card=>card.id===id)){const c=set.cards.find(card=>card.id===id);body={...c,set:{id:set.id,cardCount:set.cardCount},image:'https://assets.tcgdex.net/pt/sv/fixture151/'+c.localId,rarity:'Ilustração Rara',variants:{holo:true},types:['Grass']};}else return new Response('{}',{status:404});return new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});};
  const server=createServer({root:dir,dbPath:path.join(dir,'db.sqlite'),databaseUrl:'',pgClient,catalogFetch:providerFetch,env:{BKM_ENVIRONMENT:'demo',PAYMENT_PROVIDER:'mock',EMAIL_PROVIDER:'disabled'}});await server.api.ready;server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await server.api.close();fs.rmSync(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port,db=server.api.asyncStore;
  class Client{cookie='';csrf='';async call(route,method='GET',body){const response=await fetch(base+'/api'+route,{method,headers:{...(this.cookie?{cookie:this.cookie}:{}),...(body?{'content-type':'application/json','x-csrf-token':this.csrf}:{})},...(body?{body:JSON.stringify(body)}:{})});if(response.headers.get('set-cookie'))this.cookie=response.headers.get('set-cookie').split(';')[0];const data=await response.json();if(data.csrfToken)this.csrf=data.csrfToken;return{status:response.status,data};}}
  const ids={};for(const role of ['admin','second','customer']){ids[role]=crypto.randomUUID();await db.prepare('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)').run(ids[role],role+'@example.invalid','Fixture '+role,await hashPassword('ExistingFixture123'),role==='customer'?'CUSTOMER':'ADMIN',new Date().toISOString());}
  const login=async(role)=>{const client=new Client();await client.call('/session');assert.equal((await client.call('/auth/login','POST',{email:role+'@example.invalid',password:'ExistingFixture123'})).status,200);return client;};
  const admin=await login('admin'),customer=await login('customer'),second=await login('second'),anon=new Client();
  const body=(kind='SEALED',overrides={})=>({kind,name:'Produto real de teste',description:'Somente banco isolado',images:[{url:'/assets/pack.webp',kind:'actual'}],published:true,variants:[{language:'pt',condition:kind==='CUSTOM'?'CUSTOM':'SEALED',finish:'NORMAL',priceCents:1000,stock:3}],...overrides});
  const selection=(overrides={})=>body('SINGLE',{catalogSelection:{language:'pt',cardId:'fixture151-166',setId:set.id},name:'Nome adulterado',setId:'injected',setName:'Injetada',card:{provider:'manual',number:'999'},images:[{url:'https://example.invalid/wrong.webp',kind:'reference'}],variants:[{language:'pt',condition:'NM',finish:'HOLO',attributes:[],priceCents:1000,stock:3}],...overrides});
  return {db,admin,customer,second,anon,body,selection,login,ids,set,Client,provider:{setUnavailable:value=>{unavailable=value;},calls:()=>externalCalls}};
}
for(const engine of ['sqlite','postgres'])test(`novo editor ${engine}: identidade automática, variantes e reserva íntegra`,async t=>{
 const f=await fixture(t,engine),{admin,anon,body,selection,db}=f;
 assert.equal((await admin.call('/admin/products','POST',body('SEALED',{images:[]}))).status,422);
 const create=async data=>{const response=await admin.call('/admin/products','POST',data);assert.equal(response.status,201,JSON.stringify(response.data));return response.data;};
 await t.test('três tipos, SKU sequencial e colisão de URL sem campos técnicos',async()=>{
  const [a,b,c]=await Promise.all([create(body()),create(body()),create(body('CUSTOM'))]);assert.deepEqual([a.sku,b.sku,c.sku].sort(),['BKM1','BKM2','BKM3']);assert.equal(new Set([a.slug,b.slug,c.slug]).size,3);assert.equal(c.kind,'CUSTOM');assert.equal(c.variants[0].condition,'CUSTOM');assert.equal((await anon.call('/products?kind=CUSTOM')).data.items[0].kind,'CUSTOM');
  const edited=await admin.call('/admin/products/'+a.id,'PUT',body('SEALED',{name:'Nome atualizado',variants:a.variants}));assert.equal(edited.status,200);assert.equal(edited.data.sku,a.sku);assert.equal(edited.data.slug,a.slug);
 });
 await t.test('galeria persiste cinco fotos em ordem e recusa a sexta sem criar produto',async()=>{
  const images=Array.from({length:5},(_,index)=>({url:`https://images.example.invalid/photo-${index}.png`,kind:'actual',alt:'Foto '+index}));
  const before=(await db.prepare('SELECT COUNT(*) n FROM products').get()).n;
  const invalid=await admin.call('/admin/products','POST',body('SEALED',{images:[...images,{url:'https://images.example.invalid/extra.png',kind:'actual'}]}));assert.equal(invalid.status,422);assert.match(invalid.data.error.message,/5 fotos/);assert.equal((await db.prepare('SELECT COUNT(*) n FROM products').get()).n,before);
  const made=await create(body('SEALED',{images}));assert.deepEqual(made.images,images);const reversed=images.slice().reverse();const edited=await admin.call('/admin/products/'+made.id,'PUT',{...made,images:reversed});assert.equal(edited.status,200);assert.deepEqual(edited.data.images,reversed);assert.deepEqual((await anon.call('/products/'+made.slug)).data.images,reversed);
 });
 let card;
 await t.test('seleção de catálogo é resolvida no servidor e não altera preço ou estoque',async()=>{
  card=await create(selection());assert.equal(card.name,'Bulbasaur');assert.equal(card.setId,'fixture151');assert.equal(card.setName,'Coleção de referência');assert.equal(card.card.number,'166');assert.equal(card.card.total,'165');assert.equal(card.card.provider,'tcgdex');assert.match(card.images[0].url,/assets\.tcgdex\.net/);assert.equal(card.images[0].kind,'reference');assert.ok(!JSON.stringify(card).includes('wrong.webp'));assert.equal(card.variants[0].priceCents,1000);assert.equal(card.variants[0].stock,3);
 });
 await t.test('atributos são parte da identidade: duas variantes com mesma condição e acabamento',async()=>{
  const response=await admin.call('/admin/products/'+card.id,'PUT',{...card,variants:[{...card.variants[0],attributes:['PROMO']},{...card.variants[0],id:undefined,attributes:['STAMP','FIRST_EDITION'],stock:2}]});assert.equal(response.status,200,JSON.stringify(response.data));card=response.data;assert.equal(card.variants.length,2);assert.deepEqual(new Set(card.variants.flatMap(v=>v.attributes)),new Set(['PROMO','STAMP','FIRST_EDITION']));
  const duplicate=await admin.call('/admin/products/'+card.id,'PUT',{...card,variants:[{...card.variants[0],attributes:['PROMO','STAMP']},{...card.variants[1],attributes:['STAMP','PROMO']}]});assert.equal(duplicate.status,422);assert.equal(duplicate.data.error.code,'DUPLICATE_VARIANT');
 });
 await t.test('pedido preserva atributos e edição com reserva bloqueia troca de carta, tipo ou variante',async()=>{
  await admin.call('/admin/settings','PUT',{city:'Uberlândia',state:'MG',whatsapp:'5534999999999',shipping:{enabled:false,pickup:{enabled:true}}});
  const variant=card.variants[0],order=await f.customer.call('/checkout','POST',{items:[{variantId:variant.id,quantity:1}],deliveryMode:'pickup',idempotencyKey:crypto.randomUUID(),payment:{provider:'mock',outcome:'pending'}});assert.equal(order.status,201,JSON.stringify(order.data));const stored=await db.prepare('SELECT variant_json FROM order_items WHERE variant_id=?').get(variant.id);assert.deepEqual(JSON.parse(stored.variant_json).attributes,variant.attributes);
  for(const patch of [{variants:card.variants.map(v=>v.id===variant.id?{...v,attributes:[]}:v)},{catalogSelection:{language:'pt',cardId:'fixture151-170',setId:f.set.id}},{kind:'CUSTOM',card:null,variants:[{...variant,condition:'CUSTOM',attributes:[]}]}]){const rejected=await admin.call('/admin/products/'+card.id,'PUT',{...card,...patch});assert.equal(rejected.status,409,JSON.stringify(rejected.data));assert.equal(rejected.data.error.code,'STOCK_RESERVED_IDENTITY');}
  const allowed=await admin.call('/admin/products/'+card.id,'PUT',{...card,description:'Descrição atualizada'});assert.equal(allowed.status,200,JSON.stringify(allowed.data));assert.equal((await db.prepare('SELECT stock FROM variants WHERE id=?').get(variant.id)).stock,variant.stock);
 });
});

test('fallback manual só após pesquisa não encontrada, ligado à sessão, com expiração e consumo atômico',async t=>{
 const f=await fixture(t),{admin,body,db}=f,manual=body('SINGLE',{name:'Carta manual real',setName:'Coleção impressa',card:{name:'Carta manual real',number:'999999',provider:'manual',language:'pt'},variants:[{language:'pt',condition:'HP',finish:'MASTER_BALL',attributes:['PROMO'],priceCents:1000,stock:1}]});
 assert.equal((await admin.call('/admin/products','POST',manual)).data.error.code,'MANUAL_LOOKUP_REQUIRED');
 assert.equal((await f.customer.call('/admin/catalog/search?q=166')).status,403);assert.equal((await f.anon.call('/admin/catalog/search?q=166')).status,401);
 assert.equal((await admin.call('/admin/catalog/manual-fallback','POST',{q:'166/165',language:'pt'})).status,409);
 const search=await admin.call('/admin/catalog/search?q=999999&language=pt&live=1');assert.equal(search.status,200);assert.equal(search.data.total,0);const token=search.data.manualFallback.token;
 assert.equal((await f.second.call('/admin/products','POST',{...manual,manualFallbackToken:token})).data.error.code,'MANUAL_LOOKUP_EXPIRED');
 const bad=await admin.call('/admin/products','POST',{...manual,manualFallbackToken:token,variants:[{...manual.variants[0],stock:-1}]});assert.equal(bad.status,422);
 const invalidTransaction=await admin.call('/admin/products','POST',{...manual,manualFallbackToken:token,variants:[{...manual.variants[0],id:'foreign-variant-id'}]});assert.equal(invalidTransaction.status,422);assert.equal(Number((await db.prepare('SELECT COUNT(*) n FROM products').get()).n),0);assert.equal((await db.prepare('SELECT used_at FROM admin_catalog_fallbacks WHERE token_hash=?').get(require('../server/auth.cjs').hashToken(token))).used_at,null);
 const created=await admin.call('/admin/products','POST',{...manual,manualFallbackToken:token,attributes:{manualCatalogFallback:{reason:'forged'}}});assert.equal(created.status,201,JSON.stringify(created.data));assert.match(created.data.setId,/^manual-/);assert.equal(created.data.attributes.manualCatalogFallback.reason,'not_found');assert.equal(created.data.card.provider,'manual');
 assert.equal((await admin.call('/admin/products','POST',{...manual,manualFallbackToken:token})).data.error.code,'MANUAL_LOOKUP_EXPIRED');
 const edited=await admin.call('/admin/products/'+created.data.id,'PUT',{...created.data,description:'Descrição editada'});assert.equal(edited.status,200);
 const sessionToken=(await admin.call('/admin/catalog/manual-fallback','POST',{q:'888888',language:'pt'})).data.token;await admin.call('/auth/logout','POST',{});await admin.call('/session');await admin.call('/auth/login','POST',{email:'admin@example.invalid',password:'ExistingFixture123'});
 assert.equal((await admin.call('/admin/products','POST',{...manual,manualFallbackToken:sessionToken})).data.error.code,'MANUAL_LOOKUP_EXPIRED');
 assert.equal((await admin.call('/admin/catalog/sets?language=invalid')).status,422);
 const changingManual=await admin.call('/admin/products/'+created.data.id,'PUT',{...created.data,card:{...created.data.card,number:'another'}});assert.equal(changingManual.status,422);assert.equal(changingManual.data.error.code,'MANUAL_LOOKUP_REQUIRED');
 const token2=(await admin.call('/admin/catalog/manual-fallback','POST',{q:'999999',language:'pt'})).data.token;
 await db.prepare('UPDATE admin_catalog_fallbacks SET expires_at=? WHERE used_at IS NULL').run(Date.now()-1);assert.equal((await admin.call('/admin/products','POST',{...manual,manualFallbackToken:token2})).data.error.code,'MANUAL_LOOKUP_EXPIRED');
 f.provider.setUnavailable(true);const outage=await admin.call('/admin/catalog/search?q=anything&language=fr&live=1');assert.equal(outage.status,503);assert.equal(outage.data.error.fields.manualFallback.reason,'unavailable');
 const unavailable=await admin.call('/admin/products','POST',{...manual,manualFallbackToken:outage.data.error.fields.manualFallback.token});assert.equal(unavailable.status,201,JSON.stringify(unavailable.data));assert.equal(unavailable.data.attributes.manualCatalogFallback.reason,'unavailable');
});

test('SQLite v9 → v10 preserva IDs, estoque, pedidos, reservas e FKs; legados e CUSTOM coexistem',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bkm-migrate-product-')),filename=path.join(dir,'v9.sqlite');t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));let db=new DatabaseSync(filename),stamp=new Date().toISOString();
 db.exec(fs.readFileSync(path.join(__dirname,'../server/migrations/001_base.sql'),'utf8'));db.exec('PRAGMA user_version=9; PRAGMA foreign_keys=ON;');
 db.prepare("INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES('owner','owner@example.invalid','Owner','fixture','CUSTOMER',?)").run(stamp);
 db.prepare("INSERT INTO products VALUES('old-product','old-product','SEALED','Produto antigo','Preservar','LEGACY-1','pokemon','','',NULL,'[]','{}','produto',0,1,0,?,?)").run(stamp,stamp);
 db.prepare("INSERT INTO variants VALUES('old-variant','old-product','pt','SEALED','NORMAL',1000,NULL,3,1)").run();
 db.prepare("INSERT INTO orders VALUES('old-order','owner','PENDING','PENDING','PENDING','BRL',1000,0,0,1000,NULL,'{}',NULL,'old-key',?,?)").run(stamp,stamp);
 db.prepare("INSERT INTO order_items VALUES('old-item','old-order','old-variant','Produto antigo','LEGACY-1','{}',1,1000,1000)").run();
 db.prepare("INSERT INTO inventory_reservations VALUES('reservation','old-variant','old-order',1,'ACTIVE',?,?)").run(Date.now()+900000,stamp);db.close();db=openDatabase(filename);
 assert.equal(db.prepare('PRAGMA user_version').get().user_version,10);assert.equal(db.prepare("SELECT stock FROM variants WHERE id='old-variant'").get().stock,3);assert.equal(db.prepare("SELECT variant_id FROM order_items WHERE id='old-item'").get().variant_id,'old-variant');assert.equal(db.prepare("SELECT status FROM inventory_reservations WHERE id='reservation'").get().status,'ACTIVE');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);assert.equal(db.prepare("SELECT attributes_json FROM variant_metadata WHERE variant_id='old-variant'").get().attributes_json,'[]');db.close();
});

test('edição de referência existente durante indisponibilidade preserva somente o snapshot confiável',async t=>{
 const f=await fixture(t),made=await f.admin.call('/admin/products','POST',f.selection());assert.equal(made.status,201);
 const reference=made.data.images[0],actual=Array.from({length:4},(_,i)=>({url:`https://images.example.invalid/real-${i}.png`,kind:'actual',alt:'Foto real '+i})),gallery=[actual[0],actual[1],reference,actual[2],actual[3]];
 const changed=await f.admin.call('/admin/products/'+made.data.id,'PUT',{...made.data,images:gallery,catalogSelection:{language:'pt',cardId:'fixture151-166',setId:'fixture151'}});assert.equal(changed.status,200,JSON.stringify(changed.data));assert.deepEqual(changed.data.images,gallery,'verified reference may follow a real cover photo');
 const tooMany=await f.admin.call('/admin/products/'+made.data.id,'PUT',{...changed.data,images:[...gallery,{url:'https://images.example.invalid/extra.png',kind:'actual'}],catalogSelection:{language:'pt',cardId:'fixture151-166',setId:'fixture151'}});assert.equal(tooMany.status,422);assert.match(tooMany.data.error.message,/5 fotos/);
 const existing=await f.db.prepare('SELECT * FROM products WHERE id=?').get(made.data.id);await f.db.prepare('DELETE FROM personal_reference_cache').run();
 const {createProductWorkflow}=require('../server/product-workflow.cjs'),{ApiError}=require('../server/api.cjs');const workflow=createProductWorkflow({db:f.db,ApiError,fetchImpl:async()=>{throw Error('Unavailable controlled source');}});
 const safe=await workflow.resolve({...made.data,name:'Forged while offline',images:[{url:'https://example.invalid/forged.webp',kind:'reference'}],catalogSelection:{language:'pt',cardId:'fixture151-166',setId:'fixture151'}},existing,f.ids.admin,{});
 assert.equal(safe.data.name,'Bulbasaur');assert.equal(safe.data.card.providerId,'fixture151-166');assert.deepEqual(safe.data.images,gallery,'outage preserves trusted order and cover, not forged images');
 await assert.rejects(()=>workflow.resolve({...made.data,catalogSelection:{language:'pt',cardId:'fixture151-170',setId:'fixture151'}},existing,f.ids.admin,{}),error=>error.status===503);
});
