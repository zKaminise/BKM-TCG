'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {openStore}=require('../server/store.cjs');
const {createMypCardsProvider,selectMypReference,mypPriceKey,mypCodePath,matchProduct,minorUnits}=require('../server/mypcards-market.cjs');
const DAY=86400000,initial=Date.parse('2026-10-29T12:00:00Z');
const card=(patch={})=>({id:'sv03.5-173',providerId:'sv03.5-173',name:'Pikachu',number:'173',total:165,setId:'sv03.5',setName:'151',setCode:'MEW',language:'pt',referenceLanguage:'pt',...patch});
const row=(patch={})=>({internal_code:12345,card_code:'MEW-173/165',id_marca:2,name_pt:'Pikachu',name_en:'Pikachu',edition_pt:'151',edition_en:'151',edition_code:'MEW',deck_labels:['Pikachu MEW (173/165)'],min_price:'10.25',avg_price:'25.50',link:'https://mypcards.com/pokemon/produto/12345/pikachu',...patch});
const response=(data,status=200,headers={})=>({ok:status>=200&&status<300,status,headers:new Headers({'content-type':'application/json',...headers}),text:async()=>typeof data==='string'?data:JSON.stringify(data)});
async function fixture(t,{fetchImpl,env={},engine='sqlite',timeoutMs=4500}={}){
 const pg=engine==='postgres'?new PGlite():null;let tail=Promise.resolve();const query=async(sql,args)=>args?.length?pg.query(sql,args):(await pg.exec(sql)).at(-1),pgClient=pg?{query,end:()=>pg.close(),connect:async()=>{const previous=tail;let release;tail=new Promise(resolve=>release=resolve);await previous;return{query,release};}}:undefined;
 const db=openStore({dbPath:':memory:',pgClient,env:{}});await db.ready;t.after(()=>db.close());let clock=initial;const calls=[];
 const mock=async(url,options)=>{calls.push({url,options});return fetchImpl?fetchImpl(url,options):response({cards:[row()]});};
 const provider=createMypCardsProvider({db,fetchImpl:mock,env,now:()=>clock,timeoutMs});
 return {db,provider,calls,fetchImpl:mock,now:()=>clock,setClock:value=>clock=value,tick:value=>clock+=value};
}

test('MYP prices use exact cents; MYP code paths encode only the supplied MYP code as Base64',()=>{
 for(const [value,wanted]of[['10.25',1025],['25.5',2550],[1,100],[0,null],['0',null],[-1,null],[null,null],['1e2',null],['1.234',null],['1000001.00',null]])assert.equal(minorUnits(value),wanted);
 assert.equal(mypCodePath('MEW-173/165'),'/pokemon/precos/'+encodeURIComponent(Buffer.from('MEW-173/165').toString('base64')));assert.throws(()=>mypCodePath('x\r\ny'));
});

for(const language of['pt','en'])test('MYP verifies PT/EN printing and labels aggregate listing prices: '+language,async t=>{
 const f=await fixture(t),identity=card({language,referenceLanguage:language}),quote=await f.provider.getReference(identity);
 assert.equal(quote.status,'MATCHED');assert.equal(quote.productId,12345);assert.equal(quote.cardCode,'MEW-173/165');assert.equal(quote.match,'PRINTING_EXACT');assert.equal(quote.minPriceCents,1025);assert.equal(quote.avgPriceCents,2550);assert.equal(quote.valueCents,2550);assert.equal(quote.currency,'BRL');assert.equal(quote.aggregate,true);assert.equal(quote.condition,null);assert.equal(quote.variant,null);assert.deepEqual(quote.marketLanguages,['pt','en']);assert.equal(quote.quotedAtKind,'retrieved');assert.equal(quote.fetchedAt,new Date(initial).toISOString());assert.equal(Date.parse(quote.expiresAt)-initial,DAY);assert.equal(quote.attributionUrl,'https://mypcards.com');
 assert.equal(f.calls[0].url,'https://mypcards.com/api/v1/pokemon/carta/Pikachu');assert.equal(f.calls[0].options.headers['X-Api-Token'],undefined);assert.equal(f.calls[0].options.redirect,'error');
 const selected=selectMypReference(quote,{...identity,cardId:identity.id,variant:'NORMAL',condition:'HP',attributes:[]},initial);assert.equal(selected.usableForBrlValuation,true);assert.equal(selected.conditionAdjusted,false);
});

test('Japanese printing or physical language mismatch never fetches or reuses a PT/EN valuation',async t=>{
 const f=await fixture(t);for(const identity of[card({language:'ja',referenceLanguage:'ja'}),card({language:'ja'}),card({language:'en'})]){assert.equal((await f.provider.getReference(identity)).status,'INCOMPATIBLE');}assert.equal(f.calls.length,0);
 const quote=await f.provider.getReference(card());assert.equal(selectMypReference(quote,{...card(),language:'ja',cardId:'sv03.5-173',variant:'NORMAL'},initial),null);
});

test('same name, another edition, number or printed total cannot become a match',async t=>{
 const records=[row({internal_code:90,edition_pt:'Outra edição',edition_en:'Another Set',edition_code:'OTHER',link:'https://mypcards.com/pokemon/produto/90/pikachu'}),row({internal_code:91,card_code:'MEW-172/165',deck_labels:[],link:'https://mypcards.com/pokemon/produto/91/pikachu'}),row({internal_code:92,card_code:'MEW-173/170',deck_labels:[],link:'https://mypcards.com/pokemon/produto/92/pikachu'}),row()];
 const f=await fixture(t,{fetchImpl:async()=>response({cards:records})});assert.equal((await f.provider.getReference(card())).productId,12345);
 const other=await f.provider.getReference(card({id:'sv03.5-174',providerId:'sv03.5-174',number:'174'}),{allowFetch:false});assert.equal(other.status,'NO_MATCH');assert.equal(f.calls.length,1);
});

test('ambiguous printing is not resolved by picking the first product',async t=>{
 const f=await fixture(t,{fetchImpl:async()=>response({cards:[row(),row({internal_code:567,link:'https://mypcards.com/pokemon/produto/567/pikachu'})]})});const quote=await f.provider.getReference(card());assert.equal(quote.status,'AMBIGUOUS');assert.equal(quote.valueCents,null);assert.equal(quote.productId,null);
});

test('stockless nulls, missing results and price placeholders do not become zero valuations',async t=>{
 const f=await fixture(t,{fetchImpl:async()=>response({cards:[row({min_price:null,avg_price:null})]})}),quote=await f.provider.getReference(card());assert.equal(quote.status,'MATCHED');assert.equal(quote.minPriceCents,null);assert.equal(quote.valueCents,null);assert.match(quote.reason,/não tem preços/);assert.equal(selectMypReference(quote,{...card(),variant:'HOLO'},initial).usableForBrlValuation,false);
 const g=await fixture(t,{fetchImpl:async()=>response({cards:[]})});assert.equal((await g.provider.getReference(card())).status,'NO_MATCH');await g.provider.getReference(card());assert.equal(g.calls.length,1);assert.equal(Number((await g.db.prepare('SELECT expires_at FROM personal_reference_cache WHERE cache_key=?').get(mypPriceKey(card()))).expires_at)-initial,6*3600000);
});

test('valid persistent cache is shared across instances and resolves other printings with no HTTP fanout',async t=>{
 const f=await fixture(t,{fetchImpl:async()=>response({cards:[row(),row({internal_code:567,card_code:'MEW-174/165',deck_labels:[],link:'https://mypcards.com/pokemon/produto/567/pikachu'})]})});await f.provider.getReference(card());
 const second=createMypCardsProvider({db:f.db,now:f.now,fetchImpl:async()=>{throw Error('Unexpected network');}}),other=card({id:'sv03.5-174',providerId:'sv03.5-174',number:'174'});
 assert.equal((await second.getReference(card())).productId,12345);assert.equal((await second.getReference(other,{allowFetch:false})).productId,567);assert.equal(f.calls.length,1);
 const refs=await second.getCachedReferences([{cardId:card().id,setId:'sv03.5',referenceLanguage:'pt'},{...other,cardId:other.id}]);assert.equal(refs.size,2);assert.equal(refs.get('pt|sv03.5-174').productId,567);assert.equal(refs.get('pt|sv03.5-173').quotedAt,new Date(initial).toISOString());
});

test('expired mapping refreshes its internal product ID and verifies identity again',async t=>{
 let changed=false;const f=await fixture(t,{fetchImpl:async url=>url.includes('/produto/')?response(row({avg_price:changed?'30.00':'25.50'})):response({cards:[row()]})});const first=await f.provider.getReference(card());f.tick(DAY+1);changed=true;
 const next=await f.provider.getReference(card());assert.equal(next.valueCents,3000);assert.equal(f.calls.length,2);assert.equal(f.calls[1].url,'https://mypcards.com/api/v1/produto/12345');assert.notEqual(next.fetchedAt,first.fetchedAt);
 f.tick(DAY+1);const rejecting=createMypCardsProvider({db:f.db,now:f.now,fetchImpl:async()=>response(row({card_code:'MEW-172/165',deck_labels:[]}))});assert.equal((await rejecting.getReference(card())).status,'NO_MATCH');
});

test('API outage preserves old values with old timestamps and stale flag, excluding them from current totals',async t=>{
 let online=true;const f=await fixture(t,{fetchImpl:async url=>online?response({cards:[row()]}):response({error:'offline',code:'internal_error',status:503},503)}),first=await f.provider.getReference(card());online=false;f.tick(DAY+1);
 const stale=await f.provider.getReference(card());assert.equal(stale.valueCents,2550);assert.equal(stale.fetchedAt,first.fetchedAt);assert.equal(stale.expiresAt,first.expiresAt);assert.equal(stale.stale,true);assert.equal(stale.lastError,'UNAVAILABLE');assert.equal(selectMypReference(stale,{...card(),variant:'NORMAL'},f.now()).usableForBrlValuation,false);await f.provider.getReference(card());assert.equal(f.calls.length,2);
});

test('HTTP 403/HTML protection is not bypassed or retried, and blocks other names during cooldown',async t=>{
 const f=await fixture(t,{fetchImpl:async()=>response('<html>Challenge</html>',403,{'content-type':'text/html'})});assert.equal((await f.provider.getReference(card())).status,'UNAVAILABLE');
 const other=card({id:'sv03.5-1',providerId:'sv03.5-1',number:'1',name:'Bulbasaur'});assert.equal((await f.provider.getReference(other)).status,'UNAVAILABLE');assert.equal(f.calls.length,1);
 const g=await fixture(t,{fetchImpl:async()=>response('<html>not json</html>',200,{'content-type':'text/html'})});assert.equal((await g.provider.getReference(card())).status,'UNAVAILABLE');
});

test('timeout is bounded even when the supplied fetch ignores abort; no immediate retries',async t=>{
 const f=await fixture(t,{timeoutMs:15,fetchImpl:async()=>new Promise(()=>{})}),begin=Date.now(),quote=await f.provider.getReference(card());assert.equal(quote.status,'UNAVAILABLE');assert.ok(Date.now()-begin<1000);assert.equal(f.calls.length,1);assert.equal(f.calls[0].options.signal.aborted,true);
});

test('429 respects Retry-After and shared rate counters prevent repeated names from hammering the provider',async t=>{
 const f=await fixture(t,{fetchImpl:async()=>response({error:'limit',code:'rate_limited',status:429},429,{'retry-after':'120','x-rate-limit-limit':'10','x-rate-limit-remaining':'0'})});assert.equal((await f.provider.getReference(card())).status,'RATE_LIMITED');
 f.tick(61000);const other=card({id:'sv03.5-1',providerId:'sv03.5-1',number:'1',name:'Bulbasaur'});assert.equal((await f.provider.getReference(other)).status,'RATE_LIMITED');assert.equal(f.calls.length,1);f.tick(60000);await f.provider.getReference(other);assert.equal(f.calls.length,2);
});

test('per-route persistent request limit is ten without token and reacts to an invalid token downgrade',async t=>{
 const f=await fixture(t,{fetchImpl:async()=>response({cards:[]})});for(let i=0;i<12;i++)await f.provider.getReference(card({id:'sv03.5-'+i,providerId:'sv03.5-'+i,name:'Pokemon '+i,number:String(i)}));assert.equal(f.calls.length,10);
 const g=await fixture(t,{env:{MYP_CARDS_API_TOKEN:'test-only-token'},fetchImpl:async()=>response({cards:[]},200,{'x-rate-limit-limit':'10','x-rate-limit-remaining':'9','x-api-token-notice':'invalid'})});for(let i=0;i<12;i++)await g.provider.getReference(card({id:'sv03.5-'+i,providerId:'sv03.5-'+i,name:'Pokemon '+i,number:String(i)}));assert.equal(g.calls.length,10);assert.equal(g.calls[0].options.headers['X-Api-Token'],'test-only-token');
 const rows=await g.db.prepare("SELECT payload_json FROM personal_reference_cache WHERE kind LIKE 'myp-%'").all();assert.ok(!JSON.stringify(rows).includes('test-only-token'));
});

for(const engine of['sqlite','postgres'])test('concurrent printings and provider instances share a lease and rate reservation: '+engine,async t=>{
 let calls=0;const f=await fixture(t,{engine,fetchImpl:async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,20));return response({cards:[row()]});}}),second=createMypCardsProvider({db:f.db,now:f.now,fetchImpl:f.fetchImpl});
 const refs=await Promise.all([f.provider.getReference(card()),f.provider.getReference(card()),second.getReference(card()),f.provider.getReference(card({language:'en',referenceLanguage:'en'}))]);
 assert.equal(calls,1);assert.ok(refs.every(value=>value.status==='MATCHED'));const rate=await f.db.prepare('SELECT payload_json FROM personal_reference_cache WHERE cache_key=?').get('myp:rate:v1:name');assert.equal(JSON.parse(rate.payload_json).count,1);
});

test('special variants and attributes may display a reference but never masquerade as a compatible exact appraisal',async t=>{
 const f=await fixture(t),quote=await f.provider.getReference(card());for(const item of[{variant:'FIRST_EDITION'},{variant:'MASTER_BALL'},{variant:'PROMO'},{variant:'OTHER'},{variant:'NORMAL',attributes:['STAMP']},{variant:'NORMAL',attributes:'["PROMO"]'}]){const reference=selectMypReference(quote,{...card(),...item},initial);assert.equal(reference.usableForBrlValuation,false);assert.match(reference.unavailableReason,/especial/);}
 assert.equal(selectMypReference(quote,{...card(),setId:'wrong',variant:'NORMAL'},initial),null);assert.equal(selectMypReference(quote,{...card(),variant:'NORMAL'},initial+DAY).usableForBrlValuation,false);
});

test('invalid product, hostile source URL and incomplete identity fail closed without guessing an edition or number',async t=>{
 const f=await fixture(t,{fetchImpl:async()=>response({cards:[row({link:'https://evil.example/produto/12345'}),row({id_marca:1})]})});assert.equal((await f.provider.getReference(card())).status,'UNAVAILABLE');
 assert.equal((await f.provider.getReference(card({name:'Pikachu\nUnsafe'}))).status,'INCOMPATIBLE');
 const g=await fixture(t);await g.provider.getReference(card({name:'Farfetch’d / ex',id:'qa-1',providerId:'qa-1',number:'1'}));assert.match(g.calls[0].url,/Farfetch%E2%80%99d%20%2F%20ex$/);
});

test('disabled provider reads cache only, while an uncached name never starts an external request',async t=>{
 const f=await fixture(t);await f.provider.getReference(card());const disabled=createMypCardsProvider({db:f.db,now:f.now,env:{MYP_CARDS_ENABLED:'false'},fetchImpl:async()=>{throw Error('Must not fetch');}});
 assert.equal(disabled.enabled,false);assert.equal(disabled.configured,false);assert.equal((await disabled.getReference(card())).valueCents,2550);
 const fresh=card({id:'qa-3',providerId:'qa-3',name:'Bulbasaur',number:'3'});assert.equal((await disabled.getReference(fresh)).valueCents,null);assert.equal(f.calls.length,1);assert.equal(selectMypReference(null,fresh,initial),null);
});

test('observed rate balance accounts for other users on the same IP, and HTTP-date retry survives window rollover',async t=>{
 const f=await fixture(t,{fetchImpl:async()=>response({cards:[]},200,{'x-rate-limit-limit':'10','x-rate-limit-remaining':'2'})});for(let i=0;i<4;i++)await f.provider.getReference(card({id:'q-'+i,providerId:'q-'+i,name:'Card '+i,number:String(i)}));assert.equal(f.calls.length,3);
 const g=await fixture(t,{fetchImpl:async()=>response({error:'rate',status:429},429,{'retry-after':new Date(initial+180000).toUTCString()})});await g.provider.getReference(card());g.tick(120000);await g.provider.getReference(card({id:'q-2',providerId:'q-2',name:'Bulbasaur',number:'2'}));assert.equal(g.calls.length,1);
});

test('an observed price cannot become fresh through a future or renewed timestamp',async t=>{
 const f=await fixture(t),quote=await f.provider.getReference(card());
 for(const fetchedAt of[null,'invalid',new Date(initial+1).toISOString(),new Date(initial-DAY).toISOString()])assert.equal(selectMypReference({...quote,fetchedAt,expiresAt:new Date(initial+DAY).toISOString()},{...card(),variant:'NORMAL'},initial).usableForBrlValuation,false);
});

test('documented source link is used as returned without requiring an invented product path, and names with numbers do not override the printing number',async t=>{
 const f=await fixture(t,{fetchImpl:async()=>response({cards:[row({internal_code:456,name_pt:'Porygon2',name_en:'Porygon2',card_code:'MEW-137/165',deck_labels:['Porygon2 MEW (137/165)'],link:'https://www.mypcards.com/pokemon/456/porygon2'})]})}),quote=await f.provider.getReference(card({id:'sv03.5-137',providerId:'sv03.5-137',name:'Porygon2',number:'137'}));assert.equal(quote.status,'MATCHED');assert.equal(quote.sourceUrl,'https://www.mypcards.com/pokemon/456/porygon2');assert.equal(quote.productId,456);
});
