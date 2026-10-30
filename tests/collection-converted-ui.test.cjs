const test=require('node:test'),assert=require('node:assert/strict');
const mod=Promise.all([import('../collection-domain.js'),import('../collection-ui.js')]);
const now=Date.parse('2026-10-29T15:00:00Z');
const rate={source:'bcb_ptax',sourceLabel:'Banco Central do Brasil — PTAX venda',currency:'EUR',targetCurrency:'BRL',rateMicros:6000000,rate:6,quotedAt:'2026-10-28T16:00:00Z',fetchedAt:'2026-10-29T14:00:00Z',expiresAt:'2026-10-30T14:00:00Z',stale:false};
const quote={source:'international_fx',sourceLabel:'Referência internacional convertida em reais',currency:'BRL',valueCents:2424,originalCurrency:'EUR',originalValueCents:404,originalSource:'cardmarket',originalSourceLabel:'Cardmarket via TCGdex',sourceUrl:'https://api.tcgdex.net/v2/pt/cards/cel25-5',exchangeRate:rate,quotedAt:'2026-10-28T10:00:00Z',fetchedAt:'2026-10-29T14:00:00Z',expiresAt:'2026-10-30T14:00:00Z',converted:true,fxConverted:true,conditionAdjusted:false,providerMappingVerified:false,match:'PARTIAL',usableForBrlValuation:true,cardId:'cel25-5',setId:'cel25',referenceLanguage:'pt',language:'pt',variant:'HOLO',stale:false};
const item={kind:'CARD',cardId:'cel25-5',setId:'cel25',language:'pt',referenceLanguage:'pt',condition:'SP',variant:'HOLO',attributes:[],quantity:2,paidCents:null,convertedInternational:quote};
const el=(tag,props,...children)=>({tag,props:props||{},children:children.flat(Infinity).filter(x=>x!==null&&x!==false&&x!==undefined),get textContent(){return this.children.map(x=>typeof x==='object'?x.textContent:String(x)).join(' ');}}),money=value=>'R$ '+(value/100).toFixed(2).replace('.',','),all=node=>[node,...node.children.filter(x=>typeof x==='object').flatMap(all)];

test('converted reference prominently shows BRL while source amount and PTAX methodology stay in closed details',async()=>{
 const [domain,ui]=await mod,node=ui.createCollectionConvertedPricePanel({el,money},item,now),market=domain.collectionConverted(item,now);
 assert.equal(market.usable,true);assert.match(node.textContent,/ESTIMATIVA EM REAIS R\$ 24,24/);assert.match(node.textContent,/Não é uma cotação do mercado brasileiro/);assert.match(node.textContent,/impressão no marketplace não é certificada/);
 const details=all(node).find(x=>x.tag==='details');assert.equal(details.props.open,undefined);assert.match(details.textContent,/€\s*4,04/);assert.match(details.textContent,/1 EUR = R\$ 6,0000/);assert.match(details.textContent,/PTAX venda de 28\/10\/2026,? 13:00/);assert.match(details.textContent,/não inclui impostos/i);
 assert.ok(node.children.filter(x=>x.tag!=='details').every(x=>!x.textContent.includes('€')));assert.ok(all(node).some(x=>x.tag==='a'&&x.props.href.startsWith('https://www.bcb.gov.br/')&&x.props.rel==='noopener noreferrer'));
});

test('wizard changes to language, finish, card identity or special attributes cannot reuse another conversion',async()=>{
 const [domain,ui]=await mod;
 for(const patch of[{language:'ja'},{variant:'NORMAL'},{variant:'MASTER_BALL'},{attributes:['PROMO']},{cardId:'cel25-6'},{setId:'other'},{referenceLanguage:'en'},{kind:'CUSTOM'}]){const value={...item,...patch};assert.equal(domain.collectionConverted(value,now).usable,false);assert.equal(ui.createCollectionConvertedPricePanel({el,money},value,now),null);}
 const normal={...quote,variant:'NORMAL',valueCents:1200,originalValueCents:200};const {convertedInternational,...wizard}=item,switched={...wizard,variant:'NORMAL',card:{convertedInternationalByVariant:{NORMAL:normal}}};assert.equal(domain.collectionConverted(switched,now).reference,normal);
 const old={...quote,valueCents:1200,originalValueCents:200},fresh={...item,card:{convertedInternationalByVariant:{HOLO:old}}};assert.equal(domain.collectionConverted(fresh,now).reference,quote);assert.equal(domain.collectionConverted({...fresh,convertedInternational:null},now).usable,false);
});

test('expired, future, malformed, wrong-currency and arithmetically inconsistent conversion never becomes an estimate',async()=>{
 const [domain,ui]=await mod;
 for(const patch of[{valueCents:2423},{valueCents:0},{valueCents:null},{originalValueCents:'404'},{originalCurrency:'BRL'},{originalSource:'tcgplayer'},{currency:'EUR'},{conditionAdjusted:true},{stale:true},{quotedAt:'2026-10-30T00:00:00Z'},{quotedAt:'2026-10-20T00:00:00Z'},{fetchedAt:'invalid'},{expiresAt:'2026-10-29T14:59:00Z'},{exchangeRate:{...rate,stale:true}},{exchangeRate:{...rate,rateMicros:0}},{exchangeRate:{...rate,rateMicros:1000000001}},{exchangeRate:{...rate,quotedAt:'2026-10-20T00:00:00Z'}},{exchangeRate:{...rate,expiresAt:'2026-10-29T14:59:00Z'}}]){const value={...item,convertedInternational:{...quote,...patch}};assert.equal(domain.collectionConverted(value,now).usable,false,JSON.stringify(patch));assert.equal(ui.createCollectionConvertedPricePanel({el,money},value,now),null);}
});

test('conversion rendering is read-only and rejects untrusted source links',async()=>{
 const [,ui]=await mod,value={...item,paidCents:1500,manualValueCents:900,convertedInternational:{...quote,sourceUrl:'https://api.tcgdex.net.evil.invalid/card'}};const before=structuredClone(value),node=ui.createCollectionConvertedPricePanel({el,money},value,now);assert.deepEqual(value,before);assert.equal(all(node).filter(x=>x.tag==='a').length,1);assert.equal(value.paidCents,1500);assert.equal(value.manualValueCents,900);
});

test('queue counts current converted estimates without converting missing values or ignoring manual overrides',async()=>{
 const [domain]=await mod,active={...item,convertedInternational:{...quote,quotedAt:new Date().toISOString(),fetchedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString(),exchangeRate:{...rate,quotedAt:new Date().toISOString(),fetchedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString()}}};
 assert.deepEqual(domain.collectionQueueTotals([active]),{quantity:2,knownCost:0,unknownCost:2,unpriced:0});assert.equal(domain.collectionQueueTotals([{...active,language:'ja'}]).unpriced,2);assert.equal(domain.collectionQueueTotals([{...active,language:'ja',manualValueCents:0}]).unpriced,0);
});
