const test=require('node:test'),assert=require('node:assert/strict');
const mod=Promise.all([import('../collection-domain.js'),import('../collection-ui.js')]);
const now=Date.parse('2026-10-29T12:00:00Z'),quote={source:'mypcards',sourceLabel:'MYP Cards',currency:'BRL',status:'MATCHED',match:'PRINTING_EXACT',cardId:'base1-58',setId:'base1',referenceLanguage:'en',productId:123,cardCode:'BS-58',minPriceCents:1500,avgPriceCents:2500,valueCents:2500,fetchedAt:'2026-10-29T11:00:00Z',quotedAt:'2026-10-29T11:00:00Z',quotedAtKind:'retrieved',expiresAt:'2026-10-30T11:00:00Z',sourceUrl:'https://mypcards.com/pokemon/produto/123/pikachu',aggregate:true};
const item={kind:'CARD',cardId:'base1-58',setId:'base1',language:'en',referenceLanguage:'en',condition:'HP',variant:'NORMAL',attributes:[],quantity:2,paidCents:1000,brazilianMarket:quote};
const el=(tag,props,...children)=>({tag,props:props||{},children:children.flat(Infinity).filter(x=>x!==null&&x!==false&&x!==undefined),get textContent(){return this.children.map(x=>typeof x==='object'?x.textContent:String(x)).join(' ');}}),money=value=>'R$ '+(value/100).toFixed(2).replace('.',','),all=node=>[node,...node.children.filter(x=>typeof x==='object').flatMap(all)];

test('Brazilian offers show minimum and weighted average, attribution, observed time and aggregate caveat',async()=>{
 const [domain,ui]=await mod,market=domain.collectionBrazilian(item,now),node=ui.createCollectionBrazilianPricePanel({el,money},item,now);
 assert.equal(market.usable,true);assert.match(node.textContent,/MERCADO BRASILEIRO/);assert.match(node.textContent,/Menor preço anunciado R\$ 15,00/);assert.match(node.textContent,/Preço médio anunciado R\$ 25,00/);assert.match(node.textContent,/Consultado em: 29\/10\/2026,? 08:00/);assert.match(node.textContent,/diferentes condições, idiomas e acabamentos/);assert.match(node.textContent,/ponderada/);assert.match(node.textContent,/Não representa vendas concluídas/);
 assert.ok(all(node).some(x=>x.tag==='a'&&x.props.href==='https://mypcards.com'));assert.ok(all(node).some(x=>x.tag==='a'&&x.props.href===quote.sourceUrl&&x.props.target==='_blank'&&x.props.rel==='noopener noreferrer'));
});
test('physical JP and mismatched card/set/reference never receive the PT/EN offer',async()=>{
 const [domain,ui]=await mod;
 for(const patch of[{language:'ja'},{language:'pt'},{setId:'other'},{cardId:'base1-59'},{referenceLanguage:'pt'}]){const changed={...item,...patch};assert.equal(domain.collectionBrazilian(changed,now).hasPrices,false);assert.equal(ui.createCollectionBrazilianPricePanel({el,money},changed,now),null);}
});
test('special finish/attributes and expired offers are visible as limited references and excluded from totals',async()=>{
 const [domain,ui]=await mod;
 for(const patch of[{variant:'MASTER_BALL'},{attributes:['FIRST_EDITION']},{brazilianMarket:{...quote,expiresAt:'2026-10-29T11:59:00Z'}}]){const changed={...item,...patch},market=domain.collectionBrazilian(changed,now);assert.equal(market.hasPrices,true);assert.equal(market.usable,false);const node=ui.createCollectionBrazilianPricePanel({el,money},changed,now);assert.match(node.textContent,/sem correspondência|desatualizada/);}
});
test('null or invalid offer values never render as zero and missing average cannot value a collection',async()=>{
 const [domain,ui]=await mod,minimumOnly={...item,brazilianMarket:{...quote,avgPriceCents:null}};assert.equal(domain.collectionBrazilian(minimumOnly,now).usable,false);assert.match(ui.createCollectionBrazilianPricePanel({el,money},minimumOnly,now).textContent,/Preço médio anunciado Não disponível/);
 for(const value of[null,0,-1,NaN,'1500'])assert.equal(ui.createCollectionBrazilianPricePanel({el,money},{...item,brazilianMarket:{...quote,minPriceCents:value,avgPriceCents:value}},now),null);
});
test('untrusted links are not exposed and source consultation does not mutate acquisition or manual value',async()=>{
 const [,ui]=await mod,source={...item,manualValueCents:500,brazilianMarket:{...quote,sourceUrl:'https://mypcards.com.evil.invalid/pokemon'}};const before=structuredClone(source),node=ui.createCollectionBrazilianPricePanel({el,money},source,now);assert.deepEqual(source,before);assert.equal(all(node).filter(x=>x.tag==='a').length,1);assert.equal(source.paidCents,1000);assert.equal(source.manualValueCents,500);
});
