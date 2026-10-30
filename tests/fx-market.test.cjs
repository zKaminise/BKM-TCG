'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {openStore}=require('../server/store.cjs');
const {createFxProvider,convertInternationalReference,rateMicros,bcbTimestamp,ptaxUrl,fxRateKey}=require('../server/fx-market.cjs');
const DAY=86400000,initial=Date.parse('2026-10-29T19:00:00Z');
const body=(patch={})=>({value:[{cotacaoCompra:5.9988,cotacaoVenda:6,dataHoraCotacao:'2026-10-29 13:11:53.555689',tipoBoletim:'Fechamento',...patch}]});
const response=(data,status=200,headers={})=>({ok:status>=200&&status<300,status,headers:new Headers({'content-type':'application/json',...headers}),text:async()=>typeof data==='string'?data:JSON.stringify(data)});
async function fixture(t,{engine='sqlite',fetchImpl,timeoutMs=4500}={}){
 const pg=engine==='postgres'?new PGlite():null;let tail=Promise.resolve();const query=async(sql,args)=>args?.length?pg.query(sql,args):(await pg.exec(sql)).at(-1),pgClient=pg?{query,end:()=>pg.close(),connect:async()=>{const previous=tail;let release;tail=new Promise(resolve=>release=resolve);await previous;return{query,release};}}:undefined;
 const db=openStore({dbPath:':memory:',pgClient,env:{}});await db.ready;t.after(()=>db.close());let clock=initial;const calls=[];
 const mock=async(url,options)=>{calls.push({url,options});return fetchImpl?fetchImpl(url,options):response(body());};
 const provider=createFxProvider({db,fetchImpl:mock,now:()=>clock,timeoutMs});
 return {db,provider,calls,fetchImpl:mock,now:()=>clock,tick:value=>clock+=value};
}
function reference(patch={}){return {selected:{source:'cardmarket',sourceLabel:'Cardmarket via TCGdex',currency:'EUR',valueCents:404,quotedAt:new Date(initial-DAY).toISOString(),fetchedAt:new Date(initial).toISOString(),stale:false,cardId:'cel25-5',setId:'cel25',referenceLanguage:'pt',variant:'HOLO',sourceUrl:'https://api.tcgdex.net/v2/pt/cards/cel25-5',...patch}};}
const item=(patch={})=>({kind:'CARD',cardId:'cel25-5',setId:'cel25',referenceLanguage:'pt',language:'pt',condition:'SP',variant:'HOLO',attributes:[],...patch});

test('fixed-point rates and BCB São Paulo timestamps reject malformed, future normalization and nondecimal input',()=>{
 assert.equal(rateMicros(6),6000000);assert.equal(rateMicros('5.123456'),5123456);assert.equal(rateMicros('0.000001'),1);
 for(const raw of[null,0,-1,'1e2','6.0000001',1001,'NaN'])assert.equal(rateMicros(raw),null);
 assert.equal(bcbTimestamp('2026-10-29 13:11:53.555689'),'2026-10-29T16:11:53.555Z');
 for(const raw of['2026-02-30 12:00:00','2026-10-29T13:00:00Z','yesterday',null])assert.equal(bcbTimestamp(raw),null);
 const url=new URL(ptaxUrl('EUR',initial));assert.match(url.pathname,/CotacaoMoedaPeriodoFechamento/);assert.equal(url.searchParams.get('@codigoMoeda'),"'EUR'");assert.equal(url.searchParams.get('@dataInicialCotacao'),"'10-14-2026'");assert.equal(url.searchParams.get('@dataFinalCotacao'),"'10-29-2026'");assert.ok(!ptaxUrl('EUR',initial).includes('+'));assert.throws(()=>ptaxUrl('JPY',initial));
});

for(const engine of['sqlite','postgres'])test('two official rates are persisted and reused by another provider without network: '+engine,async t=>{
 const f=await fixture(t,{engine}),rates=await f.provider.getRates();assert.equal(f.calls.length,2);assert.equal(rates.size,2);
 const eur=rates.get('EUR');assert.equal(eur.rateMicros,6000000);assert.equal(eur.quotedAt,'2026-10-29T16:11:53.555Z');assert.equal(eur.source,'bcb_ptax');assert.equal(eur.targetCurrency,'BRL');assert.equal(eur.expiresAt,'2026-11-05T16:11:53.555Z');assert.equal(f.calls[0].options.redirect,'error');
 const other=createFxProvider({db:f.db,now:f.now,fetchImpl:async()=>{throw Error('Unexpected HTTP');}});assert.equal((await other.getRates()).get('EUR').rate,6);assert.equal((await other.getCachedRates()).size,2);
 const cached=await f.db.prepare('SELECT kind FROM personal_reference_cache WHERE cache_key=?').get(fxRateKey('EUR'));assert.equal(cached.kind,'fx-rate');
});

test('conversion is integer rounded BRL, retains actual source and does not claim Brazilian or condition-specific price',async t=>{
 const f=await fixture(t),rates=await f.provider.getRates(),converted=convertInternationalReference(reference(),item(),rates,initial);
 assert.equal(converted.valueCents,2424);assert.equal(converted.currency,'BRL');assert.equal(converted.originalCurrency,'EUR');assert.equal(converted.originalValueCents,404);assert.equal(converted.originalSource,'cardmarket');assert.equal(converted.source,'international_fx');assert.equal(converted.market,'international');assert.equal(converted.match,'PARTIAL');assert.equal(converted.conditionAdjusted,false);assert.equal(converted.providerMappingVerified,false);assert.equal(converted.fxConverted,true);assert.equal(converted.usableForBrlValuation,true);assert.equal(converted.quotedAt,reference().selected.quotedAt);assert.equal(converted.expiresAt,new Date(initial+6*DAY).toISOString());
 const half=new Map(rates);half.set('EUR',{...rates.get('EUR'),rateMicros:1500000,rate:1.5});assert.equal(convertInternationalReference(reference({valueCents:1}),item(),half,initial).valueCents,2);
 const unchanged=JSON.stringify({market:reference(),item:item(),rate:rates.get('EUR')});convertInternationalReference(reference(),item(),rates,initial);assert.equal(JSON.stringify({market:reference(),item:item(),rate:rates.get('EUR')}),unchanged);
});

test('conversion fails closed for wrong printing, stale prices, unsupported physical attributes and invalid rate',async t=>{
 const f=await fixture(t),rates=await f.provider.getRates();
 for(const patch of[{cardId:'other-5'},{setId:'other'},{referenceLanguage:'en'},{variant:'NORMAL'},{currency:'JPY'},{currency:'USD'},{stale:true},{quotedAt:new Date(initial+1).toISOString()},{quotedAt:new Date(initial-7*DAY).toISOString()},{valueCents:0},{valueCents:1.5},{sourceUrl:'https://evil.example/price'},{sourceUrl:'https://api.tcgdex.net/v2/en/cards/cel25-5'}])assert.equal(convertInternationalReference(reference(patch),item(),rates,initial),null,JSON.stringify(patch));
 for(const patch of[{kind:'CUSTOM'},{language:'ja'},{referenceLanguage:'en'},{attributes:['PROMO']},{attributes:'[]'},{variant:'MASTER_BALL'}])assert.equal(convertInternationalReference(reference(),item(patch),rates,initial),null,JSON.stringify(patch));
 for(const patch of[{stale:true},{quotedAt:new Date(initial+1).toISOString()},{quotedAt:new Date(initial-7*DAY).toISOString()},{expiresAt:new Date(initial).toISOString()},{rateMicros:0},{source:'unknown'}]){const bad=new Map(rates);bad.set('EUR',{...rates.get('EUR'),...patch});assert.equal(convertInternationalReference(reference(),item(),bad,initial),null,JSON.stringify(patch));}
});

test('each currency uses its own latest nonfuture closing bulletin and null/invalid rows never become rates',async t=>{
 const f=await fixture(t,{fetchImpl:async url=>response({value:[...body().value,{...body().value[0],cotacaoVenda:10,dataHoraCotacao:'2026-10-30 13:00:00'},{...body().value[0],cotacaoVenda:5,dataHoraCotacao:'2026-10-28 13:00:00'},{...body().value[0],cotacaoVenda:null},{...body().value[0],cotacaoVenda:20,tipoBoletim:'Intermediário'}]})});assert.equal((await f.provider.getRates()).get('EUR').rate,6);
 const invalid=await fixture(t,{fetchImpl:async()=>response(body({cotacaoVenda:null}))});assert.equal((await invalid.provider.getRates()).size,0);await invalid.provider.getRates();assert.equal(invalid.calls.length,2);
});

test('weekend or provider outage retains the actual closing date for up to seven days, never inventing a fresh rate',async t=>{
 let online=true;const f=await fixture(t,{fetchImpl:async()=>online?response(body()):response({error:'outage'},503)}),first=(await f.provider.getRates()).get('EUR');online=false;f.tick(DAY);
 const fallback=(await f.provider.getRates()).get('EUR');assert.equal(fallback.quotedAt,first.quotedAt);assert.equal(fallback.fetchedAt,first.fetchedAt);assert.equal(fallback.expiresAt,first.expiresAt);assert.equal(f.calls.length,4);await f.provider.getRates();assert.equal(f.calls.length,4);
 f.tick(7*DAY);assert.equal((await f.provider.getRates()).size,0);assert.equal(convertInternationalReference(reference(),item(),new Map([['EUR',first]]),f.now()),null);
});

test('timeouts are bounded, 429 respects cooldown and disabled/cache-only providers never issue requests',async t=>{
 const stalled=await fixture(t,{timeoutMs:15,fetchImpl:async()=>new Promise(()=>{})}),start=Date.now();assert.equal((await stalled.provider.getRates()).size,0);assert.ok(Date.now()-start<1000);assert.ok(stalled.calls.every(call=>call.options.signal.aborted));
 const limited=await fixture(t,{fetchImpl:async()=>response({},429,{'retry-after':'600'})});await limited.provider.getRates();limited.tick(6*60000);await limited.provider.getRates();assert.equal(limited.calls.length,2);
 const cold=await fixture(t);assert.equal((await cold.provider.getCachedRates()).size,0);assert.equal(cold.calls.length,0);const disabled=createFxProvider({db:cold.db,fetchImpl:cold.fetchImpl,enabled:false,now:cold.now});assert.equal((await disabled.getRates()).size,0);assert.equal(cold.calls.length,0);
});

for(const engine of['sqlite','postgres'])test('concurrent instances share one lease per currency: '+engine,async t=>{
 const f=await fixture(t,{engine,fetchImpl:async()=>{await new Promise(resolve=>setTimeout(resolve,30));return response(body());}}),other=createFxProvider({db:f.db,fetchImpl:f.fetchImpl,now:f.now});
 const results=await Promise.all([f.provider.getRates(),f.provider.getRates(),other.getRates()]);assert.equal(f.calls.length,2);assert.ok(results.every(result=>result.size===2));
});

for(const engine of['sqlite','postgres'])test('a second cold instance waits for a legitimate 650 ms PTAX response: '+engine,async t=>{
 const f=await fixture(t,{engine,fetchImpl:async()=>{await new Promise(resolve=>setTimeout(resolve,650));return response(body());}}),other=createFxProvider({db:f.db,fetchImpl:f.fetchImpl,now:f.now});
 const started=Date.now(),results=await Promise.all([f.provider.getRates(),other.getRates()]);
 assert.equal(f.calls.length,2);assert.ok(results.every(result=>result.size===2));assert.ok(results.every(result=>result.get('EUR').rate===6&&result.get('USD').rate===6));assert.ok(Date.now()-started<2500);
});
