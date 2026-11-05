const test=require('node:test'),assert=require('node:assert/strict');
const mod=import('../collection-domain.js');
const now=Date.parse('2026-10-29T12:00:00Z'),quote={source:'mypcards',sourceLabel:'MYP Cards',currency:'BRL',status:'MATCHED',match:'PRINTING_EXACT',cardId:'base1-58',setId:'base1',referenceLanguage:'en',productId:123,cardCode:'BS-58',minPriceCents:1500,avgPriceCents:2500,valueCents:2500,fetchedAt:'2026-10-29T11:00:00Z',quotedAt:'2026-10-29T11:00:00Z',quotedAtKind:'retrieved',expiresAt:'2026-10-30T11:00:00Z',sourceUrl:'https://mypcards.com/pokemon/produto/123/pikachu',aggregate:true};
const item={kind:'CARD',cardId:'base1-58',setId:'base1',language:'en',referenceLanguage:'en',condition:'HP',variant:'NORMAL',attributes:[],quantity:2,paidCents:1000,brazilianMarket:quote};

test('matched Brazilian printing exposes advertised prices and preserves actual acquisition cost',async()=>{
 const {collectionBrazilian}=await mod,before=structuredClone(item),market=collectionBrazilian(item,now);
 assert.equal(market.usable,true);
 assert.equal(market.reference.minPriceCents,1500);
 assert.equal(market.reference.avgPriceCents,2500);
 assert.equal(market.reference.aggregate,true);
 assert.equal(market.reference.sourceLabel,'MYP Cards');
 assert.deepEqual(item,before);
});

test('physical JP and mismatched card/set/reference never receive the PT/EN offer',async()=>{
 const {collectionBrazilian}=await mod;
 for(const patch of[{language:'ja'},{language:'pt'},{setId:'other'},{cardId:'base1-59'},{referenceLanguage:'pt'}]){
   assert.equal(collectionBrazilian({...item,...patch},now).hasPrices,false);
 }
});

test('special finishes, special attributes and expired offers are excluded from aggregate totals',async()=>{
 const {collectionBrazilian}=await mod;
 for(const patch of[{variant:'MASTER_BALL'},{attributes:['FIRST_EDITION']},{brazilianMarket:{...quote,expiresAt:'2026-10-29T11:59:00Z'}}]){
   const market=collectionBrazilian({...item,...patch},now);
   assert.equal(market.hasPrices,true);
   assert.equal(market.usable,false);
   assert.match(market.unavailableReason,/sem correspondência|desatualizada/);
 }
});

test('invalid offer values and missing averages cannot value a collection',async()=>{
 const {collectionBrazilian}=await mod,minimumOnly={...item,brazilianMarket:{...quote,avgPriceCents:null}};
 assert.equal(collectionBrazilian(minimumOnly,now).usable,false);
 for(const value of[null,0,-1,NaN,'1500']){
   assert.equal(collectionBrazilian({...item,brazilianMarket:{...quote,minPriceCents:value,avgPriceCents:value}},now).hasPrices,false);
 }
});
