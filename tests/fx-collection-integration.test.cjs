'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {openStore}=require('../server/store.cjs');
const {createPersonalCollection}=require('../server/personal-collection.cjs');
class ApiError extends Error{constructor(status,code,message){super(message);Object.assign(this,{status,code});}}
const DAY=86400000,rid=()=>crypto.randomUUID();
async function fixture(t,engine='sqlite'){
 const pg=engine==='postgres'?new PGlite():null;let tail=Promise.resolve();
 const query=async(sql,args)=>args?.length?pg.query(sql,args):(await pg.exec(sql)).at(-1),pgClient=pg?{query,end:()=>pg.close(),connect:async()=>{const previous=tail;let release;tail=new Promise(resolve=>release=resolve);await previous;return{query,release};}}:undefined;
 const db=openStore({dbPath:':memory:',pgClient,env:{}});await db.ready;t.after(()=>db.close());let clock=Date.parse('2026-10-29T12:00:00Z'),fxOnline=true,tcgOnline=true,mypCalls=0;
 const sourceDate=new Date(clock-DAY).toISOString(),sets=[{id:'cel25',name:'Celebrações',abbreviation:{official:'CEL'},serie:{id:'swsh',name:'Espada e Escudo'},cardCount:{official:25,total:25}}];
 const briefs=[{id:'cel25-5',localId:'5',name:'Pikachu'},{id:'cel25-6',localId:'6',name:'Pikachu'},{id:'cel25-7',localId:'7',name:'Pikachu'}];
 const tcgFetch=async input=>{const url=new URL(input);assert.equal(url.origin,'https://api.tcgdex.net');if(!tcgOnline)throw Error('TCGdex offline');const [lang,type,id]=url.pathname.split('/').slice(2);let data=null;
  if(type==='series')data=[{id:'swsh',name:'Espada e Escudo'}];if(type==='sets'&&!id)data=sets;
  if(type==='sets'&&id&&id===sets[0].id)data={...sets[0],cards:briefs};if(type==='cards'&&!id)data=briefs;
  if(type==='cards'&&id){const brief=briefs.find(row=>row.id===id);if(brief)data={...brief,set:{id:'cel25',cardCount:sets[0].cardCount},variants:{normal:id!=='cel25-5',holo:id==='cel25-5',reverse:false},image:`https://assets.tcgdex.net/${lang}/swsh/cel25/${brief.localId}`,pricing:{cardmarket:{unit:'EUR',updated:sourceDate,trend:id==='cel25-5'?4.04:2}}};}
  return{ok:data!==null,status:data===null?404:200,text:async()=>JSON.stringify(data)};
 };
 const fxCalls=[],fxFetch=async(input)=>{const url=new URL(input);fxCalls.push(url.href);assert.equal(url.origin,'https://olinda.bcb.gov.br');if(!fxOnline)throw Error('BCB offline');const currency=url.searchParams.get('@codigoMoeda');return{ok:true,status:200,headers:new Headers({'content-type':'application/json'}),text:async()=>JSON.stringify({value:[{cotacaoVenda:currency==="'EUR'"?6:5,dataHoraCotacao:'2026-10-28 13:00:00.000',tipoBoletim:'Fechamento'}]})};};
 const mypCardsFetch=async()=>{mypCalls++;return{ok:false,status:403,headers:new Headers({'content-type':'text/html'}),text:async()=>'<html>Blocked</html>'};};
 const service=createPersonalCollection({db,ApiError,fetchImpl:tcgFetch,mypCardsFetch,fxFetch,env:{MYP_CARDS_ENABLED:'true',FX_CONVERSION_ENABLED:'true'},now:()=>clock}),user={id:rid()};
 await db.prepare("INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,'unusable','CUSTOMER',?)").run(user.id,user.id+'@example.invalid','Collector QA',new Date(clock).toISOString());
 const call=async(method,path,body={},search='')=>(await service.handle({user,method,path:'/api/account/collection'+path,body,query:new URLSearchParams(search)})).data;
 const card=(id='cel25-5',overrides={})=>({kind:'CARD',itemType:'SINGLE',cardId:id,setId:'cel25',referenceLanguage:'pt',language:'pt',condition:'SP',variant:id==='cel25-5'?'HOLO':'NORMAL',...overrides});
 return{db,user,call,card,fxCalls,mypCalls:()=>mypCalls,now:()=>clock,tick:ms=>clock+=ms,offline:()=>{fxOnline=false;tcgOnline=false;}};
}

for(const engine of['sqlite','postgres'])test('BRL international fallback reaches inventory totals, sorting, binders and CSV without changing costs: '+engine,async t=>{
 const f=await fixture(t,engine),found=await f.call('GET','/catalog/search',{},'q=Pikachu&language=pt');
 const pikachu=found.items.find(card=>card.id==='cel25-5');assert.equal(pikachu.convertedInternational.valueCents,2424);assert.equal(pikachu.convertedInternational.originalValueCents,404);assert.equal(pikachu.convertedInternational.exchangeRate.rateMicros,6000000);assert.equal(pikachu.convertedInternational.currency,'BRL');assert.equal(pikachu.convertedInternational.market,'international');assert.equal(pikachu.convertedInternational.conditionAdjusted,false);assert.equal(pikachu.convertedInternationalByVariant.NORMAL,null);assert.equal(f.fxCalls.length,2);assert.equal(f.mypCalls(),1);
 const created=await f.call('POST','/inventory/batch',{requestId:rid(),items:[f.card(undefined,{quantity:2,paidCents:1000}),f.card('cel25-6',{paidCents:400}),f.card('cel25-7',{manualValueCents:888,paidCents:200}),f.card(undefined,{language:'ja',referenceLanguage:'pt',paidCents:300}),f.card(undefined,{attributes:['STAMP'],paidCents:500})]});assert.equal(created.added,6);
 let list=await f.call('GET','/inventory',{},'group=set&sort=value&dir=desc');assert.equal(list.totals.quantity,6);assert.equal(list.totals.estimatedValueCents,6936);assert.equal(list.totals.paidCents,3400);assert.equal(list.totals.knownValueQuantity,4);assert.equal(list.totals.convertedReferenceQuantity,3);assert.equal(list.totals.estimateIncludesConversion,true);assert.equal(list.totals.brazilianAggregateQuantity,0);assert.equal(list.totals.unpricedQuantity,2);assert.equal(list.totals.partial,true);assert.equal(list.groups[0].estimatedValueCents,6936);assert.equal(list.items[0].estimatedValueCents,2424);
 const converted=list.items.find(item=>item.cardId==='cel25-5'&&item.language==='pt'&&!item.attributes.length);assert.equal(converted.valuation.source,'international_fx');assert.equal(converted.valuation.match,'PARTIAL');assert.equal(converted.valuation.fxConverted,true);assert.equal(converted.valuation.condition,null);assert.equal(converted.paidCents,1000);
 const manual=list.items.find(item=>item.cardId==='cel25-7');assert.equal(manual.valuation.source,'user_manual');assert.equal(manual.valuation.valueCents,888);assert.equal(manual.convertedInternational.valueCents,1200);
 for(const item of list.items.filter(item=>item.language==='ja'||item.attributes.length)){assert.equal(item.valuation,null);assert.equal(item.convertedInternational,null);}
 assert.equal((await f.call('GET','/inventory',{},'price=known')).total,4);assert.equal((await f.call('GET','/inventory',{},'price=missing')).total,2);assert.equal((await f.call('GET','/inventory',{},'minValue=2400&maxValue=2500')).total,2);
 const summary=await f.call('GET','/summary');assert.equal(summary.totals.estimatedValueCents,6936);assert.equal(summary.totals.convertedReferenceQuantity,3);assert.ok(summary.topCards.some(item=>item.valuation.fxConverted));
 const binder=await f.call('POST','/sets',{setId:'cel25',language:'pt',goal:{mode:'custom',includeSecrets:true}});assert.equal(binder.estimatedValueCents,6936);assert.equal(binder.convertedReferenceQuantity,3);
 const checklist=await f.call('GET','/sets/'+binder.id,{},'variant=HOLO');assert.equal(checklist.items.find(item=>item.id==='cel25-5').valuation.source,'international_fx');
 const exported=await f.call('GET','/export');assert.match(exported.csv,/referência internacional convertida em reais pela PTAX do Banco Central/);assert.match(exported.csv,/2424/);assert.match(exported.csv,/1000/);
 assert.equal(f.fxCalls.length,2,'cached rates are shared across all views/printings');
 f.offline();f.tick(2*DAY);list=await f.call('GET','/inventory');assert.equal(list.totals.estimatedValueCents,6936,'recent real rate remains usable through a temporary outage');
 f.tick(6*DAY);list=await f.call('GET','/inventory');assert.equal(list.totals.convertedReferenceQuantity,0);assert.equal(list.totals.estimatedValueCents,0,'expired FX/source references do not inflate estimated totals');assert.equal(list.totals.knownValueQuantity,0);assert.equal(list.totals.paidCents,3400);assert.equal(list.items.find(item=>item.cardId==='cel25-7').valuation.source,'user_manual');
 const costs=await f.db.prepare('SELECT paid_cents FROM personal_lots WHERE user_id=? ORDER BY paid_cents').all(f.user.id);assert.deepEqual(costs.map(row=>row.paid_cents),[200,300,400,500,1000,1000]);
});

test('the first filtered inventory request warms cached source conversions before SQL price filtering',async t=>{
 const f=await fixture(t);await f.call('POST','/inventory/batch',{requestId:rid(),items:[f.card(undefined,{paidCents:1234})]});
 await f.db.prepare("DELETE FROM personal_reference_cache WHERE kind='fx-price'").run();
 const filtered=await f.call('GET','/inventory',{},'price=known&sort=value');assert.equal(filtered.total,1);assert.equal(filtered.items[0].estimatedValueCents,2424);assert.equal(filtered.totals.estimatedValueCents,2424);assert.equal(filtered.items[0].paidCents,1234);
});

test('conversion warmup deduplicates exemplar identities and does not rewrite unchanged quotes',async t=>{
 const f=await fixture(t);await f.call('POST','/inventory/batch',{requestId:rid(),items:[f.card(undefined,{quantity:12,paidCents:100})]});
 await f.db.prepare("DELETE FROM personal_reference_cache WHERE kind='fx-price'").run();
 const original=f.db.prepare.bind(f.db);let writes=0;
 f.db.prepare=sql=>{const statement=original(sql);if(!sql.startsWith('INSERT INTO personal_reference_cache'))return statement;return new Proxy(statement,{get(target,key){if(key==='run')return(...args)=>{if(args[1]==='fx-price')writes++;return target.run(...args);};const value=target[key];return typeof value==='function'?value.bind(target):value;}});};
 let list=await f.call('GET','/inventory');assert.equal(list.totals.estimatedValueCents,29088);assert.equal(writes,1,'one bulk write for twelve copies of the same printing/finish');
 f.tick(10000);list=await f.call('GET','/inventory');assert.equal(list.totals.convertedReferenceQuantity,12);assert.equal(writes,1,'stable source/FX timestamps do not trigger repeated writes');
});

for(const engine of['sqlite','postgres'])test('current Brazilian/exact references outrank conversion consistently in DTO and SQL: '+engine,async t=>{
 const f=await fixture(t,engine);await f.call('POST','/inventory/batch',{requestId:rid(),items:[f.card(undefined,{paidCents:1000})]});
 const quote={source:'mypcards',sourceLabel:'MYP Cards',currency:'BRL',status:'MATCHED',match:'PRINTING_EXACT',cardId:'cel25-5',setId:'cel25',referenceLanguage:'pt',productId:12345,cardCode:'CEL-5/25',minPriceCents:2500,avgPriceCents:3333,valueCents:3333,sourceUrl:'https://mypcards.com/pokemon/produto/12345/pikachu',fetchedAt:new Date(f.now()).toISOString(),quotedAt:new Date(f.now()).toISOString(),expiresAt:new Date(f.now()+DAY).toISOString(),aggregate:true,marketLanguages:['pt','en'],condition:null,variant:null,stale:false};
 await f.db.prepare("INSERT INTO personal_reference_cache(cache_key,kind,language,reference_id,payload_json,fetched_at,expires_at) VALUES(?,'myp-price','pt','cel25-5',?,?,?) ON CONFLICT(cache_key) DO UPDATE SET payload_json=excluded.payload_json,fetched_at=excluded.fetched_at,expires_at=excluded.expires_at").run('myp:price:v1:pt|cel25-5',JSON.stringify(quote),f.now(),f.now()+DAY);
 let list=await f.call('GET','/inventory',{},'price=known&sort=value');assert.equal(list.totals.estimatedValueCents,3333);assert.equal(list.items[0].valuation.source,'mypcards');assert.equal(list.totals.convertedReferenceQuantity,0);assert.equal(list.totals.brazilianAggregateQuantity,1);
 await f.call('POST','/prices',{cardId:'cel25-5',setId:'cel25',language:'pt',condition:'SP',variant:'HOLO',valueCents:777});
 list=await f.call('GET','/inventory',{},'price=known&sort=value');assert.equal(list.items[0].valuation.valueCents,777);assert.equal(list.totals.estimatedValueCents,777);assert.equal(list.totals.convertedReferenceQuantity,0);assert.equal(list.totals.brazilianAggregateQuantity,0);assert.equal(list.items[0].convertedInternational.valueCents,2424);
});
