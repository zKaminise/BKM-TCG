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
}
test('collection dashboard renders persisted inventory/native references and recovers from request errors without search-scope globals',async t=>{
  const previous={window:global.window,localStorage:global.localStorage,location:global.location};t.after(()=>Object.assign(global,previous));
  global.window={addEventListener(){}};global.localStorage={getItem(){return null;}};global.location={search:''};
  const el=(tag,props,...children)=>new Node(tag,props,children),button=(content,fn,cls,props={})=>el('button',{class:cls,...props,onClick:fn},content),field=(text,name,type,value)=>el('label',{},text,el('input',{name,type,value})),selectField=(text,name,options,value)=>el('label',{},text,el('select',{name,value},options.map(([id,label])=>el('option',{value:id},label))));
  const marketData={knownFinishes:['HOLO'],references:[{source:'cardmarket',sourceLabel:'Cardmarket via TCGdex',currency:'EUR',valueCents:6495,quotedAt:new Date().toISOString(),variant:'HOLO',sourceUrl:'https://api.tcgdex.net/v2/pt/cards/sv03.5-166'}]};
  let fail=false;const item={id:'persisted-item',kind:'CARD',status:'IN_COLLECTION',cardId:'sv03.5-166',language:'pt',referenceLanguage:'pt',variant:'HOLO',condition:'HP',quantity:1,paidCents:2500,card:{name:'Bulbasaur',setName:'151',displayNumber:'166/165',marketData},marketData};
  const ctx={el,button,field,selectField,checkbox:(text)=>el('label',{},text,el('input',{type:'checkbox'})),message:(text)=>el('p',{},text),empty:(...content)=>el('div',{},content),image:(url,alt)=>el('img',{src:url,alt}),money:value=>`R$ ${(value/100).toFixed(2)}`,api:async()=>{if(fail)throw Error('Catálogo temporariamente indisponível');return {items:[item],total:1,facets:{},totals:{quantity:1,paidCents:2500},internationalTotals:[{sourceLabel:'Cardmarket via TCGdex',currency:'EUR',valueCents:6495,quantity:1}]};},navigate(){},toast(){},refresh(){},getState:()=>({user:{id:'smoke-owner'}}),svgIcon:()=>el('svg',{}),collectionNav:()=>el('nav',{})};
  const {createCollectionUI}=await import('../collection-ui.js');const screen=createCollectionUI(ctx);const dashboard=await screen.dashboard();assert.match(dashboard.textContent,/Bulbasaur/);assert.match(dashboard.textContent,/64,95/);assert.match(dashboard.textContent,/Somente os exemplares ativos desta página/);assert.doesNotMatch(dashboard.textContent,/seq is not defined/);assert.equal(dashboard.querySelectorAll('div').some(node=>node.attributes['aria-busy']==='true'),false);
  fail=true;const failed=await screen.dashboard();assert.match(failed.textContent,/Catálogo temporariamente indisponível/);assert.doesNotMatch(failed.textContent,/is not defined/);
});
