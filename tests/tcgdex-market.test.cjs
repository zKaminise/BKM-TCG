'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {minorUnits,normalizeTcgdexMarket,selectInternationalMarket,internationalTotals}=require('../server/tcgdex-market.cjs');
const {collectionMetrics}=require('../server/personal-inventory.cjs');
const now=Date.parse('2026-10-27T12:00:00Z');
const raw=(overrides={})=>({id:'sv03.5-166',set:{id:'sv03.5'},variants:{holo:true,normal:false,reverse:false},pricing:{cardmarket:{unit:'EUR',updated:'2026-10-26T22:54:32Z',trend:64.95,'trend-holo':0},tcgplayer:{unit:'USD',updated:'2026-10-26T22:55:00Z',holofoil:{marketPrice:61.17}}},...overrides});

test('TCGdex maps actual provider shape, exact minor units and native source identity without inventing Brazilian condition prices',()=>{
  for(const[value,expected]of[[64.95,6495],['61.17',6117],[1,100],[0,null],[-1,null],[null,null],['1e2',null],[1.234,null],['garbage',null]])assert.equal(minorUnits(value),expected,String(value));
  const data=normalizeTcgdexMarket(raw(),{language:'pt',now});assert.equal(data.references.length,2);
  assert.deepEqual(data.references.map(q=>[q.source,q.currency,q.valueCents,q.variant]),[['cardmarket','EUR',6495,'HOLO'],['tcgplayer','USD',6117,'HOLO']]);
  for(const q of data.references){assert.equal(q.cardId,'sv03.5-166');assert.equal(q.setId,'sv03.5');assert.equal(q.referenceLanguage,'pt');assert.equal(q.marketLanguage,null);assert.equal(q.condition,null);assert.equal(q.match,'PARTIAL');assert.equal(q.conditionAdjusted,false);assert.equal(q.usableForBrlValuation,false);assert.equal(q.brazilian,false);assert.equal(q.converted,false);assert.equal(q.providerMappingVerified,false);assert.equal(q.sourceUrl,'https://api.tcgdex.net/v2/pt/cards/sv03.5-166');}
  const selected=selectInternationalMarket(data,{variant:'HOLO',condition:'HP',language:'pt'},now);assert.equal(selected.selected.valueCents,6117);assert.equal(selected.conditionMatched,false);assert.equal(selected.languageMatched,false);
  assert.equal(selectInternationalMarket(data,{variant:'NORMAL'},now).selected,null);
  assert.equal(selectInternationalMarket(data,{variant:'HOLO',attributes:['STAMP']},now).selected,null);
});

test('unsupported/missing units, zero placeholders, impossible dates and unspecified finishes never become current exact estimates',()=>{
  const data=normalizeTcgdexMarket(raw({variants:{normal:true,reverse:true},pricing:{cardmarket:{unit:'EUR',updated:'2026-10-26',trend:.1,'trend-holo':.2}}}),{now});
  assert.equal(data.references[0].variant,null);assert.equal(data.references.length,1);assert.equal(selectInternationalMarket(data,{variant:'NORMAL'},now).selected,null);
  for(const pricing of[{cardmarket:{unit:'BRL',updated:'2026-10-26',trend:10}},{tcgplayer:{unit:'EUR',updated:'2026-10-26',normal:{marketPrice:10}}},{cardmarket:{unit:'EUR',updated:'2030-01-01',trend:10}},{cardmarket:{unit:'EUR',trend:10}},{cardmarket:{unit:'EUR',updated:'2026-10-26',trend:0}}])assert.equal(normalizeTcgdexMarket(raw({pricing}),{now}).references.length,0);
});

test('fresh native totals exclude stale/sold/archived copies and never mix with BRL, costs, manual value or gain',()=>{
  const marketData=normalizeTcgdexMarket(raw(),{now});const make=(quantity,status='IN_COLLECTION')=>({kind:'CARD',cardId:'sv03.5-166',referenceLanguage:'pt',variant:'HOLO',attributes:[],condition:'NM',status,quantity,paidCents:1000,valuation:null,internationalMarket:selectInternationalMarket(marketData,{variant:'HOLO'},now)});
  const items=[make(2),make(3,'SOLD'),make(7,'ARCHIVED')];const native=internationalTotals(items);assert.deepEqual(native.map(t=>[t.currency,t.valueCents,t.quantity]),[['EUR',12990,2],['USD',12234,2]]);
  const brl=collectionMetrics(items);assert.equal(brl.currency,'BRL');assert.equal(brl.estimatedValueCents,0);assert.equal(brl.comparableQuantity,0);assert.equal(brl.paidCents,2000);
  const manual={...make(1),valuation:{currency:'BRL',valueCents:5000,match:'EXACT',manual:true}};assert.equal(collectionMetrics([manual]).estimatedValueCents,5000);assert.equal(internationalTotals([manual]).find(q=>q.currency==='EUR').valueCents,6495);
  const stale=selectInternationalMarket(marketData,{variant:'HOLO'},now+8*86400000);assert.equal(stale.current.length,0);assert.equal(stale.compatible.length,2);assert.equal(stale.selected,null);
});

test('browser and backend select identical international references while edits change finish/attributes immediately',async()=>{
  const {collectionInternational,collectionForeignMoney}=await import('../collection-domain.js');const marketData=normalizeTcgdexMarket(raw(),{now});
  for(const item of[{variant:'HOLO'},{variant:'NORMAL'},{variant:'HOLO',attributes:['PROMO']}])assert.deepEqual(collectionInternational({...item,card:{marketData}},now),selectInternationalMarket(marketData,item,now));
  assert.match(collectionForeignMoney(6495,'EUR'),/64,95/);assert.match(collectionForeignMoney(6117,'USD'),/61,17/);assert.equal(collectionForeignMoney(6117,'BRL'),'Indisponível');
});
