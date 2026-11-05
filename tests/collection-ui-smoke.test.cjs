const test=require('node:test'),assert=require('node:assert/strict');

// A small DOM host exercises the actual screen's async render/error/finally
// lifecycle without duplicating its load function or depending on a browser.
class Node {
  constructor(tag,props={},children=[]){this.tag=tag;Object.assign(this,props);this.attributes={...props};this.children=[];this.events={};this.classList={toggle(){},add(){},remove(){}};this.append(...children);}
  append(...children){this.children.push(...children.flat(Infinity).filter(child=>child!==null&&child!==undefined&&child!==false));}
  replaceChildren(...children){this.children=[];this.append(...children);}
  setAttribute(key,value){this.attributes[key]=value;}
  removeAttribute(key){delete this.attributes[key];}
  addEventListener(key,fn){this.events[key]=fn;}
  querySelectorAll(tag){return this.children.flatMap(child=>child instanceof Node?[...(child.tag===tag?[child]:[]),...child.querySelectorAll(tag)]:[]);}
  querySelector(tag){return this.querySelectorAll(tag)[0]||null;}
  get textContent(){return this.children.map(child=>child instanceof Node?child.textContent:String(child)).join(' ');}
  set textContent(value){this.replaceChildren(value);}
}
test('collection dashboard displays aggregate estimates and actual paid cost, with filters and selection on demand',async t=>{
  const previous={window:global.window,localStorage:global.localStorage,location:global.location};t.after(()=>Object.assign(global,previous));
  global.window={addEventListener(){}};global.localStorage={getItem(){return null;}};global.location={search:''};
  const el=(tag,props,...children)=>new Node(tag,props,children),button=(content,fn,cls,props={})=>el('button',{class:cls,...props,onClick:fn},content),field=(text,name,type,value)=>el('label',{},text,el('input',{name,type,value})),selectField=(text,name,options,value)=>el('label',{},text,el('select',{name,value},options.map(([id,label])=>el('option',{value:id},label))));
  const marketData={knownFinishes:['HOLO'],references:[{source:'cardmarket',sourceLabel:'Cardmarket via TCGdex',currency:'EUR',valueCents:6495,quotedAt:new Date().toISOString(),variant:'HOLO',sourceUrl:'https://api.tcgdex.net/v2/pt/cards/sv03.5-166'}]};
  let fail=false,converted=false;const item={id:'persisted-item',kind:'CARD',status:'IN_COLLECTION',cardId:'sv03.5-166',setId:'sv03.5',language:'pt',referenceLanguage:'pt',variant:'HOLO',condition:'HP',quantity:1,paidCents:2500,card:{name:'Bulbasaur',setName:'151',displayNumber:'166/165',marketData},marketData};
  const observed=new Date().toISOString(),expires=new Date(Date.now()+3600000).toISOString(),convertedInternational={source:'international_fx',currency:'BRL',valueCents:38970,originalCurrency:'EUR',originalValueCents:6495,originalSource:'cardmarket',originalSourceLabel:'Cardmarket via TCGdex',sourceUrl:'https://api.tcgdex.net/v2/pt/cards/sv03.5-166',exchangeRate:{source:'bcb_ptax',currency:'EUR',targetCurrency:'BRL',rateMicros:6000000,quotedAt:observed,fetchedAt:observed,expiresAt:expires},quotedAt:observed,fetchedAt:observed,expiresAt:expires,converted:true,fxConverted:true,conditionAdjusted:false,match:'PARTIAL',usableForBrlValuation:true,cardId:item.cardId,setId:item.setId,referenceLanguage:'pt',language:'pt',variant:'HOLO'};
  const ctx={el,button,field,selectField,checkbox:(text)=>el('label',{},text,el('input',{type:'checkbox'})),message:(text)=>el('p',{},text),empty:(...content)=>el('div',{},content),image:(url,alt)=>el('img',{src:url,alt}),money:value=>`R$ ${(value/100).toFixed(2)}`,api:async()=>{if(fail)throw Error('Catálogo temporariamente indisponível');return {items:[converted?{...item,convertedInternational}:item],total:1,facets:{},totals:{quantity:1,paidCents:2500,...converted?{knownValueQuantity:1,convertedReferenceQuantity:1,estimatedValueCents:38970}:{}},internationalTotals:[{sourceLabel:'Cardmarket via TCGdex',currency:'EUR',valueCents:6495,quantity:1}]};},navigate(){},toast(){},refresh(){},getState:()=>({user:{id:'smoke-owner'}}),svgIcon:()=>el('svg',{}),collectionNav:()=>el('nav',{})};
  const {createCollectionUI}=await import('../collection-ui.js');const screen=createCollectionUI(ctx);const dashboard=await screen.dashboard();
  const card=dashboard.querySelector('article'),stats=dashboard.querySelectorAll('div').find(node=>node.class==='collection-stats');
  assert.match(card.textContent,/Em coleção Bulbasaur 151 · 166\/165 HP Pago R\$ 25\.00/);
  assert.match(stats.textContent,/Valor estimado — Sem estimativa disponível Valor gasto R\$ 25\.00/);
  assert.doesNotMatch(dashboard.textContent,/64,95|Cardmarket|referência de mercado disponível/i);
  assert.equal(card.querySelector('input'),null);
  assert.equal(card.querySelector('button').attributes['aria-label'],'Ver detalhes de Bulbasaur');
  const filter=dashboard.querySelectorAll('section').find(node=>node.id==='collection-inventory-filters');
  const filterToggle=dashboard.querySelectorAll('button').find(node=>node.textContent==='Buscar e filtrar');
  assert.equal(filter.hidden,true);
  filterToggle.onClick();assert.equal(filter.hidden,false);assert.equal(filterToggle.attributes['aria-expanded'],'true');
  filterToggle.onClick();assert.equal(filter.hidden,true);
  const select=dashboard.querySelectorAll('button').find(node=>node.textContent==='Selecionar');
  select.onClick();
  const checkbox=dashboard.querySelector('article').querySelector('input');
  assert.equal(checkbox.attributes['aria-label'],'Selecionar Bulbasaur');
  checkbox.onChange({target:{checked:true}});
  assert.match(dashboard.textContent,/1 item selecionado/);
  select.onClick();
  assert.equal(dashboard.querySelector('article').querySelector('input'),null);
  assert.doesNotMatch(dashboard.textContent,/1 item selecionado/);
  assert.equal(dashboard.querySelectorAll('div').some(node=>node.attributes['aria-busy']==='true'),false);
  converted=true;
  const priced=await screen.dashboard();
  assert.match(priced.textContent,/Valor estimado R\$ 389\.70/);
  assert.doesNotMatch(priced.querySelector('article').textContent,/389\.70|Estimativa em reais|64,95/i);
  assert.equal((priced.textContent.match(/R\$ 389\.70/g)||[]).length,1);
  fail=true;const failed=await screen.dashboard();assert.match(failed.textContent,/Catálogo temporariamente indisponível/);assert.doesNotMatch(failed.textContent,/is not defined/);
});
