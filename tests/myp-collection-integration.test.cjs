'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {openStore}=require('../server/store.cjs');
const {createPersonalCollection}=require('../server/personal-collection.cjs');
class ApiError extends Error{constructor(status,code,message){super(message);Object.assign(this,{status,code});}}
const DAY=86400000,rid=()=>crypto.randomUUID();
async function fixture(t,engine='sqlite',{blocked=false}={}){
 const pg=engine==='postgres'?new PGlite():null;let tail=Promise.resolve();
 const query=async(sql,args)=>args?.length?pg.query(sql,args):(await pg.exec(sql)).at(-1),pgClient=pg?{query,end:()=>pg.close(),connect:async()=>{const previous=tail;let release;tail=new Promise(resolve=>release=resolve);await previous;return{query,release};}}:undefined;
 const db=openStore({dbPath:':memory:',pgClient,env:{}});await db.ready;t.after(()=>db.close());let clock=Date.parse('2026-10-29T12:00:00Z'),mypOnline=true;
 const sets=[{id:'sv03.5',name:'151',abbreviation:{official:'MEW'},serie:{id:'sv',name:'Escarlate e Violeta'},cardCount:{official:165,total:207}},{id:'sv02',name:'Evoluções em Paldea',abbreviation:{official:'PAL'},serie:{id:'sv',name:'Escarlate e Violeta'},cardCount:{official:193,total:279}}];
 const briefs=[{id:'sv03.5-173',localId:'173',name:'Pikachu'},{id:'sv03.5-174',localId:'174',name:'Pikachu'},{id:'sv02-173',localId:'173',name:'Pikachu'}];
 const tcgFetch=async input=>{const url=new URL(input);assert.equal(url.origin,'https://api.tcgdex.net');const [lang,type,id]=url.pathname.split('/').slice(2);let data=null;
  if(type==='series')data=[{id:'sv',name:'Escarlate e Violeta'}];
  if(type==='sets'&&!id)data=sets;
  if(type==='sets'&&id){const set=sets.find(row=>row.id===id);if(set)data={...set,cards:briefs.filter(row=>row.id.startsWith(id+'-'))};}
  if(type==='cards'&&!id)data=briefs;
  if(type==='cards'&&id){const brief=briefs.find(row=>row.id===id),set=sets.find(row=>id.startsWith(row.id+'-'));if(brief)data={...brief,set:{id:set.id,cardCount:set.cardCount},variants:{normal:true,holo:false,reverse:false},image:`https://assets.tcgdex.net/${lang}/sv/${set.id}/${brief.localId}`,pricing:{cardmarket:{unit:'EUR',updated:new Date(clock).toISOString(),trend:7}}};}
  return{ok:data!==null,status:data===null?404:200,text:async()=>JSON.stringify(data)};
 };
 const product=(internal_code,card_code,edition_code,edition_pt,avg_price)=>({internal_code,card_code,id_marca:2,name_pt:'Pikachu',name_en:'Pikachu',edition_pt,edition_en:edition_pt,edition_code,deck_labels:[`Pikachu ${edition_code} (${card_code.split('-').at(-1)})`],min_price:'10.25',avg_price,link:`https://mypcards.com/pokemon/produto/${internal_code}/pikachu`});
 const records=[product(12345,'MEW-173/165','MEW','151','25.50'),product(12346,'MEW-174/165','MEW','151','30.00'),product(12347,'PAL-173/193','PAL','Evoluções em Paldea','40.00')],calls=[];
 const mypCardsFetch=async(input,options)=>{const url=new URL(input);calls.push({url:url.href,headers:options.headers});assert.equal(url.origin,'https://mypcards.com');if(!mypOnline)throw Error('Controlled MYP outage');if(blocked)return{ok:false,status:403,headers:new Headers({'content-type':'text/html'}),text:async()=>'<html>Blocked</html>'};const data=url.pathname.includes('/pokemon/carta/')?{cards:records}:records.find(row=>String(row.internal_code)===url.pathname.split('/').at(-1));return{ok:!!data,status:data?200:404,headers:new Headers({'content-type':'application/json'}),text:async()=>JSON.stringify(data)};};
 const service=createPersonalCollection({db,ApiError,fetchImpl:tcgFetch,mypCardsFetch,env:{MYP_CARDS_ENABLED:'true'},now:()=>clock}),user={id:rid()};
 await db.prepare("INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,'unusable','CUSTOMER',?)").run(user.id,user.id+'@example.invalid','Collector QA',new Date(clock).toISOString());
 const call=async(method,path,body={},search='')=>(await service.handle({user,method,path:'/api/account/collection'+path,body,query:new URLSearchParams(search)})).data;
 const card=(id='sv03.5-173',overrides={})=>({kind:'CARD',itemType:'SINGLE',cardId:id,setId:id.slice(0,id.lastIndexOf('-')),referenceLanguage:'pt',language:'pt',condition:'HP',variant:'NORMAL',...overrides});
 return{db,service,user,call,card,calls,now:()=>clock,tick:ms=>clock+=ms,offline:()=>mypOnline=false};
}

for(const engine of['sqlite','postgres'])test('MYP collection integration: matching, shared cache, manual precedence and complete SQL totals: '+engine,async t=>{
 const f=await fixture(t,engine);
 const found=await f.call('GET','/catalog/search',{},'q=Pikachu&language=pt&pageSize=18');assert.equal(found.items.length,3);assert.ok(found.items.every(card=>card.name==='Pikachu'&&card.brazilianMarket.status==='MATCHED'));assert.deepEqual(new Set(found.items.map(card=>card.brazilianMarket.avgPriceCents)),new Set([2550,3000,4000]));assert.equal(f.calls.length,1,'one exact-name request resolves all printings');assert.equal(f.calls[0].headers['X-Api-Token'],undefined);
 const selected=await f.call('GET','/catalog/card',{},'cardId=sv03.5-173&setId=sv03.5&language=en');assert.equal(selected.brazilianMarket.referenceLanguage,'en');assert.equal(f.calls.length,1);
 const created=await f.call('POST','/inventory/batch',{requestId:rid(),items:[f.card(undefined,{quantity:2,paidCents:1000}),f.card(undefined,{language:'en',referenceLanguage:'en',paidCents:1500}),f.card('sv03.5-174',{manualValueCents:999,paidCents:200}),f.card(undefined,{language:'ja',referenceLanguage:'ja',paidCents:300}),f.card(undefined,{attributes:['FIRST_EDITION'],paidCents:400})]});assert.equal(created.added,6);
 let list=await f.call('GET','/inventory',{},'group=set&sort=value&dir=desc');
 assert.equal(list.totals.quantity,6);assert.equal(list.totals.paidCents,4400);assert.equal(list.totals.estimatedValueCents,8649);assert.equal(list.totals.knownValueQuantity,4);assert.equal(list.totals.brazilianAggregateQuantity,3);assert.equal(list.totals.estimateIncludesAggregates,true);assert.equal(list.totals.unpricedQuantity,2);assert.equal(list.totals.partial,true);assert.equal(list.groups[0].estimatedValueCents,8649);
 const automatic=list.items.find(item=>item.language==='en');assert.equal(automatic.valuation.source,'mypcards');assert.equal(automatic.valuation.match,'PRINTING_EXACT');assert.equal(automatic.valuation.condition,null);assert.equal(automatic.valuation.conditionAdjusted,false);assert.equal(automatic.valuation.aggregate,true);assert.equal(automatic.paidCents,1500);
 const manual=list.items.find(item=>item.cardId==='sv03.5-174');assert.equal(manual.valuation.source,'user_manual');assert.equal(manual.valuation.valueCents,999);assert.equal(manual.brazilianMarket.avgPriceCents,3000);
 const japanese=list.items.find(item=>item.language==='ja');assert.equal(japanese.brazilianMarket,null);assert.equal(japanese.valuation,null);assert.equal(japanese.internationalMarket.selected.currency,'EUR');
 const special=list.items.find(item=>item.attributes.length);assert.equal(special.valuation,null);assert.equal(special.brazilianMarket.usableForBrlValuation,false);
 assert.equal((await f.call('GET','/inventory',{},'price=known')).total,4);assert.equal((await f.call('GET','/inventory',{},'price=missing')).total,2);assert.equal((await f.call('GET','/inventory',{},'minValue=2500&maxValue=2600')).total,3);assert.equal(list.items[0].estimatedValueCents,2550);
 const summary=await f.call('GET','/summary');assert.equal(summary.totals.estimatedValueCents,8649);assert.equal(summary.totals.brazilianAggregateQuantity,3);assert.ok(summary.topCards.some(item=>item.valuation.source==='mypcards'));
 const binder=await f.call('POST','/sets',{setId:'sv03.5',language:'pt',goal:{mode:'custom',includeSecrets:true}});assert.equal(binder.estimatedValueCents,6099);assert.equal(binder.brazilianAggregateQuantity,2);const checklist=await f.call('GET','/sets/'+binder.id);assert.equal(checklist.items.find(item=>item.id==='sv03.5-173').valuation.source,'mypcards');
 const exported=await f.call('GET','/export');assert.match(exported.csv,/MYP Cards — média agregada de anúncios PT\/EN/);assert.match(exported.csv,/2550/);assert.match(exported.csv,/1000/);
 const quantities=await f.db.prepare('SELECT paid_cents FROM personal_lots WHERE user_id=? ORDER BY paid_cents').all(f.user.id);assert.deepEqual(quantities.map(row=>row.paid_cents),[200,300,400,1000,1000,1500]);
 f.tick(DAY+1);f.offline();await f.call('POST','/inventory/market-refresh',{ids:created.items.map(item=>item.id)});list=await f.call('GET','/inventory',{},'sort=value');assert.equal(list.totals.estimatedValueCents,999);assert.equal(list.totals.brazilianAggregateQuantity,0);assert.equal(list.totals.unpricedQuantity,5);assert.ok(list.items.find(item=>item.language==='en').brazilianMarket.stale);assert.equal(list.items.find(item=>item.language==='en').paidCents,1500);
 const cached=(await f.db.prepare("SELECT * FROM personal_reference_cache WHERE kind='myp-price'").all()).find(row=>row.expires_at>f.now()&&JSON.parse(row.payload_json).stale);assert.ok(cached,'a failed price refresh has a future retry cooldown');assert.ok(Date.parse(JSON.parse(cached.payload_json).expiresAt)<f.now(),'original price expiry was not renewed');
 assert.equal((await f.call('GET','/sets')).items[0].staleQuantity,2,'special attributes do not count as formerly compatible stale appraisals');
});

test('MYP collection gracefully falls back internationally after official API access is unavailable',async t=>{
 const f=await fixture(t,'sqlite',{blocked:true}),found=await f.call('GET','/catalog/search',{},'q=Pikachu&language=pt');assert.ok(found.items.every(item=>item.brazilianMarket?.valueCents==null));assert.equal(f.calls.length,1,'Cloudflare rejection is not retried per printing');
 const made=await f.call('POST','/inventory/batch',{requestId:rid(),items:[f.card(undefined,{paidCents:1234})]});const list=await f.call('GET','/inventory');assert.equal(list.totals.knownValueQuantity,0);assert.equal(list.totals.unpricedQuantity,1);assert.equal(list.totals.partial,true);assert.equal(list.items[0].paidCents,1234);assert.equal(list.items[0].valuation,null);assert.equal(list.items[0].internationalMarket.selected.currency,'EUR');assert.equal(list.items[0].internationalMarket.selected.valueCents,700);assert.equal(made.added,1);
});

test('a physical JP copy using a PT image cannot suppress the valid PT copy refresh',async t=>{
 const f=await fixture(t),created=await f.call('POST','/inventory/batch',{requestId:rid(),items:[f.card(undefined,{language:'ja',referenceLanguage:'pt',paidCents:100}),f.card(undefined,{paidCents:200})]});assert.equal(f.calls.length,0);
 const japanese=created.items.find(item=>item.language==='ja');await f.db.prepare('UPDATE personal_lots SET created_at=? WHERE id=?').run(new Date(f.now()+1).toISOString(),japanese.id);
 const list=await f.call('GET','/inventory');assert.equal(list.items[0].language,'ja');assert.equal(list.items[0].brazilianMarket,null);assert.equal(list.items.find(item=>item.language==='pt').valuation.valueCents,2550);assert.equal(list.totals.estimatedValueCents,2550);assert.equal(f.calls.length,1);
});
