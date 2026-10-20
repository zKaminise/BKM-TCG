const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {openStore,migratePostgres}=require('../server/store.cjs');
const {createMarketPriceService,MarketPriceProvider,ManualAuthorizedPriceProvider}=require('../server/market-price-provider.cjs');
const {createPersonalCollection}=require('../server/personal-collection.cjs');
class ApiError extends Error {constructor(status,code,message){super(message);Object.assign(this,{status,code});}}

async function fixture(t,engine) {
  let pg;const pgClient=engine==='postgres'?(pg=new PGlite(),{query:async(sql,args)=>args?.length?pg.query(sql,args):(await pg.exec(sql)).at(-1),end:()=>pg.close()}):undefined;
  const db=openStore({dbPath:':memory:',pgClient,env:{}});await db.ready;t.after(()=>db.close());
  let clock=Date.parse('2026-10-01T12:00:00Z');
  const service=createMarketPriceService({db,ApiError,now:()=>clock}),admin={id:crypto.randomUUID(),role:'ADMIN'},other={id:crypto.randomUUID(),role:'ADMIN'},customer={id:crypto.randomUUID(),role:'CUSTOMER'};
  for(const [user,name]of[[admin,'Admin'],[other,'Outro'],[customer,'Cliente']])await db.prepare('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)').run(user.id,name.toLowerCase()+'@example.test',name,'unusable$fixture',user.role,new Date(clock).toISOString());
  const call=async(user,method,route='',body={},search='')=>(await service.handleAdmin({user,method,path:'/api/admin/market-prices'+route,body,query:new URLSearchParams(search)})).data;
  const csv=(value=1200,currency='BRL',extra='')=>'setId,cardId,language,condition,variant,valueCents,currency'+(extra?',methodology':'')+'\n'+'test1,test1-001,pt,NM,HOLO,'+value+','+currency+(extra?','+extra:'');
  const defaults={sourceLabel:'Referência manual autorizada de teste',sourceUrl:'https://example.test/licensed-reference',quotedAt:'2026-10-01T10:00:00Z'};
  return {db,pgClient,service,admin,other,customer,call,csv,defaults,advance:ms=>clock+=ms,now:()=>clock};
}

for(const engine of ['sqlite','postgres'])test('Preços globais manuais autorizados: '+engine,async t=>{
  const f=await fixture(t,engine),{db,admin,other,customer,call}=f;
  await t.test('admin real obrigatório e consentimento de direitos obrigatório na confirmação',async()=>{
    await assert.rejects(call(null,'GET'),error=>error.status===401);
    await assert.rejects(call(customer,'GET'),error=>error.status===403);
    await assert.rejects(call({...customer,role:'ADMIN'},'POST','/import/preview',{csv:f.csv(),...f.defaults}),error=>error.status===403);
    assert.equal(await f.service.handleAdmin({path:'/api/products',method:'GET'}),null);
    const status=await call(admin,'GET');assert.equal(status.total,0);assert.equal(status.providers.find(provider=>provider.id==='ligapokemon').configured,false);assert.equal(status.providers[0].automated,false);
    const preview=await call(admin,'POST','/import/preview',{csv:f.csv(),...f.defaults});assert.equal(preview.canConfirm,true);
    await assert.rejects(call(admin,'POST','/import/confirm',{token:preview.token}),error=>error.code==='PRICE_RIGHTS_REQUIRED');
    await assert.rejects(call(other,'POST','/import/confirm',{token:preview.token,rightsConfirmed:true}),error=>error.status===404);
    const saved=await call(admin,'POST','/import/confirm',{token:preview.token,rightsConfirmed:true});assert.equal(saved.imported,1);assert.equal(saved.created,1);
    assert.deepEqual(await call(admin,'POST','/import/confirm',{token:preview.token,rightsConfirmed:true}),saved);
  });
  await t.test('provider utiliza só referências globais e exige identidade/moeda/variante comparáveis',async()=>{
    const card={id:'test1-001',setId:'test1',language:'pt'},quote=await f.service.provider.getQuote({card,language:'pt',condition:'NM',variant:'HOLO'});
    assert.equal(quote.valueCents,1200);assert.equal(quote.currency,'BRL');assert.equal(quote.source,'admin_manual');assert.equal(quote.methodology,'manual');assert.equal(quote.manual,true);assert.equal(quote.coverage,'manual_authorized');assert.equal(quote.stale,false);
    for(const variation of [{language:'en'},{condition:'LP'},{variant:'REVERSE'},{card:{...card,setId:'other'}},{card:{...card,id:'test1-002'}}])assert.equal(await f.service.provider.getQuote({card,language:'pt',condition:'NM',variant:'HOLO',...variation}),null);
    await assert.rejects(f.service.provider.getQuote({card,language:'pt',currency:'USD'}),error=>error.code==='PRICE_CURRENCY_UNSUPPORTED');
    await db.prepare('INSERT INTO personal_prices(id,user_id,set_id,card_id,language,condition,variant,value_cents,currency,source,source_label,source_url,methodology,observations,quoted_at,recorded_at,coverage) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),customer.id,'test1','test1-002','pt','NM','NORMAL',99999,'BRL','user_manual','Privado do cliente','','manual',null,'2026-10-01T10:00:00Z','2026-10-01T12:00:00Z','user_reported');
    assert.equal(await f.service.provider.getQuote({card:{id:'test1-002',setId:'test1',language:'pt'},language:'pt',condition:'NM',variant:'NORMAL'}),null);
    assert.equal((await call(admin,'GET')).items.length,1);
    const bulk=await f.service.provider.getQuotes([{cardId:card.id,setId:card.setId,language:'pt',condition:'NM',variant:'HOLO'},{cardId:card.id,setId:card.setId,language:'en',condition:'NM',variant:'HOLO'}]);assert.equal(bulk.length,1);assert.equal(bulk[0].id,quote.id);
  });
  let personal;
  await t.test('coleção aplica referência global em lote sem fabricar histórico pessoal e preserva valor manual próprio',async()=>{
    const card={id:'test1-001',name:'Pikachu',localId:'001',set:{id:'test1'},rarity:'Rare',variants:{holo:true},image:'https://assets.tcgdex.net/pt/test/test1/001'},set={id:'test1',name:'Coleção teste',cardCount:{official:1,total:1},cards:[card]};
    personal=createPersonalCollection({db,ApiError,priceProvider:f.service.provider,now:f.now,fetchImpl:async url=>({ok:true,text:async()=>JSON.stringify(String(url).includes('/sets/')?set:card)})});
    const invoke=async(method,route,body={})=>(await personal.handle({user:customer,method,path:'/api/account/collection'+route,body})).data;
    await invoke('POST','/items',{cardId:card.id,setId:'test1',language:'pt',condition:'NM',variant:'HOLO',quantity:2});
    const before=(await db.prepare('SELECT COUNT(*) count FROM personal_prices WHERE user_id=?').get(customer.id)).count;
    const summary=await invoke('GET','/summary');assert.equal(summary.totals.estimatedValueCents,2400);assert.equal(summary.topCards[0].valuation.source,'admin_manual');assert.equal(summary.topCards[0].valuation.manual,true);assert.equal(summary.priceProviders.automated,false);
    assert.equal((await db.prepare('SELECT COUNT(*) count FROM personal_prices WHERE user_id=?').get(customer.id)).count,before);
    await invoke('POST','/prices',{cardId:card.id,setId:'test1',language:'pt',condition:'NM',variant:'HOLO',valueCents:1400});
    const own=await invoke('GET','/summary');assert.equal(own.totals.estimatedValueCents,2800);assert.equal(own.topCards[0].valuation.source,'user_manual');
  });
  await t.test('CSV não converte moedas nem aceita mediana fictícia, datas futuras ou fontes inseguras',async()=>{
    const csv='setId,cardId,language,condition,variant,valueCents,currency,methodology\n'+'test1,test1-001,pt,NM,HOLO,100,USD,manual\n'+'test1,test1-001,pt,NM,HOLO,100,BRL,median\n'+'test1,other-001,pt,NM,HOLO,100,BRL,manual';
    const bad=await call(admin,'POST','/import/preview',{csv,...f.defaults});assert.equal(bad.canConfirm,false);assert.equal(bad.errors.length,3);
    await assert.rejects(call(admin,'POST','/import/confirm',{token:bad.token,rightsConfirmed:true}),error=>error.status===422);
    const unsafe=await call(admin,'POST','/import/preview',{csv:f.csv(),...f.defaults,sourceUrl:'javascript:alert(1)'});assert.equal(unsafe.canConfirm,false);
    const future=await call(admin,'POST','/import/preview',{csv:f.csv(),...f.defaults,quotedAt:'2099-01-01T00:00:00Z'});assert.equal(future.canConfirm,false);
    assert.equal((await call(admin,'GET')).total,1);
  });
  await t.test('nova prévia do mesmo CSV deduplica cotação e TTL mostra referência desatualizada sem fabricar histórico',async()=>{
    const preview=await call(admin,'POST','/import/preview',{csv:f.csv(),...f.defaults});const result=await call(admin,'POST','/import/confirm',{token:preview.token,rightsConfirmed:true});assert.equal(result.created,0);assert.equal((await call(admin,'GET')).total,1);
    f.advance(8*86400000);const quote=await f.service.provider.getQuote({card:{id:'test1-001',setId:'test1',language:'pt'},language:'pt',condition:'NM',variant:'HOLO'});assert.equal(quote.stale,true);assert.equal(quote.quotedAt,'2026-10-01T10:00:00.000Z');
    const summary=(await personal.handle({user:customer,method:'GET',path:'/api/account/collection/summary'})).data;assert.equal(summary.totals.estimatedValueCents,0);assert.equal(summary.totals.staleQuantity,2);
    await assert.rejects(personal.handle({user:customer,method:'POST',path:'/api/account/collection/prices/refresh',body:{cardId:'test1-001',setId:'test1',language:'pt',condition:'NM',variant:'HOLO'}}),error=>error.code==='PRICE_STALE');
    const expiring=await call(admin,'POST','/import/preview',{csv:f.csv(1300),...f.defaults});f.advance(31*60000);await assert.rejects(call(admin,'POST','/import/confirm',{token:expiring.token,rightsConfirmed:true}),error=>error.status===410);
  });
  await t.test('500 cotações em lote são atômicas, paginadas e protegidas por RLS nas duas tabelas PostgreSQL',async()=>{
    const csv='setId,cardId,language,condition,variant,valueCents,currency\n'+Array.from({length:500},(_,index)=>'mass,mass-'+String(index+1).padStart(3,'0')+',pt,NM,NORMAL,'+(index+1)+',BRL').join('\n');
    const preview=await call(admin,'POST','/import/preview',{csv,...f.defaults});assert.equal(preview.rows.length,500);assert.equal(preview.canConfirm,true);
    const original=db.prepare;let count=0;db.prepare=function(sql){count++;return original.call(db,sql);};
    try{const saved=await call(admin,'POST','/import/confirm',{token:preview.token,rightsConfirmed:true});assert.equal(saved.created,500);assert.ok(count<20);}finally{db.prepare=original;}
    const page=await call(admin,'GET','',{},'setId=mass&page=2&pageSize=25');assert.equal(page.items.length,25);assert.equal(page.total,500);assert.equal(page.page,2);
    if(engine==='postgres'){await migratePostgres(f.pgClient);const rows=await db.prepare("SELECT tablename,rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename IN('market_quotes','market_imports')").all();assert.equal(rows.length,2);assert.ok(rows.every(row=>row.rowsecurity));}
  });
});

test('Preços globais: contrato base e TTL inválido recusam configuração incompleta',async()=>{
  await assert.rejects(new MarketPriceProvider().getQuote({}),error=>error.code==='PRICE_PROVIDER_UNAVAILABLE');
  assert.throws(()=>new ManualAuthorizedPriceProvider({db:{},ttlDays:0}),error=>error.code==='PRICE_TTL_INVALID');
});
