const test=require('node:test'),assert=require('node:assert/strict');
const mod=import('../collection-domain.js');
const now=Date.parse('2026-10-29T15:00:00Z');
const rate={source:'bcb_ptax',sourceLabel:'Banco Central do Brasil — PTAX venda',currency:'EUR',targetCurrency:'BRL',rateMicros:6000000,rate:6,quotedAt:'2026-10-28T16:00:00Z',fetchedAt:'2026-10-29T14:00:00Z',expiresAt:'2026-10-30T14:00:00Z',stale:false};
const quote={source:'international_fx',sourceLabel:'Referência internacional convertida em reais',currency:'BRL',valueCents:2424,originalCurrency:'EUR',originalValueCents:404,originalSource:'cardmarket',originalSourceLabel:'Cardmarket via TCGdex',sourceUrl:'https://api.tcgdex.net/v2/pt/cards/cel25-5',exchangeRate:rate,quotedAt:'2026-10-28T10:00:00Z',fetchedAt:'2026-10-29T14:00:00Z',expiresAt:'2026-10-30T14:00:00Z',converted:true,fxConverted:true,conditionAdjusted:false,providerMappingVerified:false,match:'PARTIAL',usableForBrlValuation:true,cardId:'cel25-5',setId:'cel25',referenceLanguage:'pt',language:'pt',variant:'HOLO',stale:false};
const item={kind:'CARD',cardId:'cel25-5',setId:'cel25',language:'pt',referenceLanguage:'pt',condition:'SP',variant:'HOLO',attributes:[],quantity:2,paidCents:null,convertedInternational:quote};

test('a fresh conversion keeps the original reference while leaving acquisition and manual price intact',async()=>{
 const {collectionConverted}=await mod,value={...item,paidCents:1500,manualValueCents:900},before=structuredClone(value);
 const market=collectionConverted(value,now);
 assert.equal(market.usable,true);
 assert.equal(market.reference.currency,'BRL');
 assert.equal(market.reference.valueCents,2424);
 assert.equal(market.reference.originalValueCents,404);
 assert.equal(market.reference.originalCurrency,'EUR');
 assert.equal(market.reference.exchangeRate.source,'bcb_ptax');
 assert.deepEqual(value,before);
});

test('changes to language, finish, card identity or special attributes cannot reuse another conversion',async()=>{
 const {collectionConverted}=await mod;
 for(const patch of[{language:'ja'},{variant:'NORMAL'},{variant:'MASTER_BALL'},{attributes:['PROMO']},{cardId:'cel25-6'},{setId:'other'},{referenceLanguage:'en'},{kind:'CUSTOM'}]){
   assert.equal(collectionConverted({...item,...patch},now).usable,false);
 }
 const normal={...quote,variant:'NORMAL',valueCents:1200,originalValueCents:200};
 const {convertedInternational,...wizard}=item;
 const switched={...wizard,variant:'NORMAL',card:{convertedInternationalByVariant:{NORMAL:normal}}};
 assert.equal(collectionConverted(switched,now).reference,normal);
 const old={...quote,valueCents:1200,originalValueCents:200},fresh={...item,card:{convertedInternationalByVariant:{HOLO:old}}};
 assert.equal(collectionConverted(fresh,now).reference,quote);
 assert.equal(collectionConverted({...fresh,convertedInternational:null},now).usable,false);
});

test('expired, future, malformed, wrong-currency and arithmetically inconsistent conversion never becomes an estimate',async()=>{
 const {collectionConverted}=await mod;
 for(const patch of[{valueCents:2423},{valueCents:0},{valueCents:null},{originalValueCents:'404'},{originalCurrency:'BRL'},{originalSource:'tcgplayer'},{currency:'EUR'},{conditionAdjusted:true},{stale:true},{quotedAt:'2026-10-30T00:00:00Z'},{quotedAt:'2026-10-20T00:00:00Z'},{fetchedAt:'invalid'},{expiresAt:'2026-10-29T14:59:00Z'},{exchangeRate:{...rate,stale:true}},{exchangeRate:{...rate,rateMicros:0}},{exchangeRate:{...rate,rateMicros:1000000001}},{exchangeRate:{...rate,quotedAt:'2026-10-20T00:00:00Z'}},{exchangeRate:{...rate,expiresAt:'2026-10-29T14:59:00Z'}}]){
   assert.equal(collectionConverted({...item,convertedInternational:{...quote,...patch}},now).usable,false,JSON.stringify(patch));
 }
});

test('queue counts current converted estimates without converting missing values or ignoring manual overrides',async()=>{
 const {collectionQueueTotals}=await mod;
 const current=new Date().toISOString(),expires=new Date(Date.now()+3600000).toISOString();
 const active={...item,convertedInternational:{...quote,quotedAt:current,fetchedAt:current,expiresAt:expires,
   exchangeRate:{...rate,quotedAt:current,fetchedAt:current,expiresAt:expires}}};
 assert.deepEqual(collectionQueueTotals([active]),{quantity:2,knownCost:0,unknownCost:2,unpriced:0});
 assert.equal(collectionQueueTotals([{...active,language:'ja'}]).unpriced,2);
 assert.equal(collectionQueueTotals([{...active,language:'ja',manualValueCents:0}]).unpriced,0);
});
