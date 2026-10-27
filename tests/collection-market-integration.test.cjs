'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {openStore}=require('../server/store.cjs');
const {createCollectionCatalog}=require('../server/collection-catalog.cjs');
const {createPersonalInventory}=require('../server/personal-inventory.cjs');
class ApiError extends Error{constructor(status,code,message){super(message);Object.assign(this,{status,code});}}

for(const engine of ['sqlite','postgres'])test('automatic market references persist, refresh daily and preserve private BRL valuations: '+engine,async t=>{
  const pg=engine==='postgres'?new PGlite():null,pgClient=pg?{query:async(sql,args)=>args?.length?pg.query(sql,args):(await pg.exec(sql)).at(-1),end:()=>pg.close()}:undefined;
  const db=openStore({dbPath:':memory:',pgClient,env:{}});await db.ready;t.after(()=>db.close());let clock=Date.parse('2026-10-27T12:00:00Z'),online=true,cardCalls=0;
  const set={id:'sv03.5',name:'151',serie:{id:'sv',name:'Scarlet & Violet'},cardCount:{official:165,total:207},cards:[{id:'sv03.5-166',name:'Bulbasaur',localId:'166'}]};
  const raw={id:'sv03.5-166',localId:'166',name:'Bulbasaur',set:{id:set.id,cardCount:set.cardCount},variants:{normal:false,holo:true,reverse:false},image:'https://assets.tcgdex.net/pt/sv/sv03.5/166',pricing:{cardmarket:{unit:'EUR',updated:new Date(clock).toISOString(),trend:64.95}}};
  const fetchImpl=async input=>{const url=new URL(input);assert.equal(url.origin,'https://api.tcgdex.net');if(!online)throw Error('Provider offline');let data=null;const path=url.pathname.split('/').slice(3).join('/');if(path==='sets/'+set.id)data=set;if(path==='cards/'+raw.id){cardCalls++;data=raw;}return {ok:!!data,status:data?200:404,text:async()=>JSON.stringify(data)};};
  const catalog=createCollectionCatalog({db,ApiError,fetchImpl,now:()=>clock}),inventory=createPersonalInventory({db,ApiError,catalog,legacyPrices:async()=>new Map(),preferences:async()=>({priceTtlDays:7}),now:()=>clock});
  const alice=crypto.randomUUID(),bob=crypto.randomUUID();for(const id of[alice,bob])await db.prepare("INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,'unusable','CUSTOMER',?)").run(id,id+'@example.invalid','Collector',new Date(clock).toISOString());
  const call=async(user,method,path,body={},query='')=>(await inventory.handle(user,method,path,body,new URLSearchParams(query))).data;
  const created=await call(alice,'POST','/inventory/batch',{requestId:crypto.randomUUID(),items:[{kind:'CARD',itemType:'SINGLE',cardId:raw.id,setId:set.id,referenceLanguage:'pt',language:'pt',condition:'HP',variant:'HOLO',quantity:2,paidCents:1000,manualValueCents:5000}]});
  assert.equal(created.added,2);assert.equal(cardCalls,1);const id=created.items[0].id;
  const snapshot=JSON.parse((await db.prepare('SELECT metadata_json FROM personal_lots WHERE id=?').get(id)).metadata_json);assert.equal(snapshot.marketData.references[0].valueCents,6495);assert.equal(snapshot.marketData.references[0].condition,null);
  let list=await call(alice,'GET','/inventory');assert.equal(list.internationalScope,'page');assert.equal(list.internationalTotals[0].currency,'EUR');assert.equal(list.internationalTotals[0].valueCents,12990);assert.equal(list.internationalTotals[0].quantity,2);assert.equal(list.totals.estimatedValueCents,10000);assert.equal(list.totals.paidCents,2000);assert.equal(list.totals.unrealizedGainCents,8000);assert.equal(list.items[0].internationalMarket.conditionMatched,false);assert.equal(list.items[0].valuation.manual,true);assert.equal(cardCalls,1);
  await assert.rejects(call(bob,'POST','/inventory/market-refresh',{ids:[id]}),error=>error.status===404);await assert.rejects(call(alice,'POST','/inventory/market-refresh',{ids:[]}),error=>error.status===422);await assert.rejects(call(alice,'POST','/inventory/market-refresh',{ids:Array(25).fill(id)}),error=>error.status===422);
  clock+=86400001;raw.pricing.cardmarket.trend=70;raw.pricing.cardmarket.updated=new Date(clock).toISOString();const refreshed=await call(alice,'POST','/inventory/market-refresh',{ids:[id]});assert.equal(cardCalls,2);assert.equal(refreshed.items[0].internationalMarket.selected.valueCents,7000);assert.equal(refreshed.items[0].valuation.valueCents,5000);
  list=await call(alice,'GET','/inventory');assert.equal(list.internationalTotals[0].valueCents,14000);assert.equal(list.totals.estimatedValueCents,10000);assert.equal(cardCalls,2);
  online=false;clock+=8*86400000;list=await call(alice,'GET','/inventory');assert.equal(list.total,2);assert.equal(list.internationalTotals.length,0);assert.equal(list.items[0].internationalMarket.selected,null);assert.equal(list.items[0].internationalMarket.compatible[0].stale,true);assert.equal(list.items[0].paidCents,1000);
});
