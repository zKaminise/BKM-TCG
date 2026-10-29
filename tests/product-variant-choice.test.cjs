const test=require('node:test'),assert=require('node:assert/strict');
const ui=import('../product-labels.js');
class Element{
 constructor(tag,attrs={},children=[]){this.tag=tag;this.attrs={...attrs};this.children=children;this.className=attrs.class||'';this.classList={toggle:(name,enabled)=>{const values=new Set(this.className.split(/\s+/).filter(Boolean));enabled?values.add(name):values.delete(name);this.className=[...values].join(' ');}};}
 setAttribute(key,value){this.attrs[key]=value;}
 get textContent(){return this.children.map(child=>child instanceof Element?child.textContent:String(child)).join(' ');}
 all(){return[this,...this.children.flatMap(child=>child instanceof Element?child.all():[])];}
 async click(){if(!this.attrs.disabled)return this.attrs.onClick?.({currentTarget:this});}
}
const el=(tag,attrs={},...children)=>new Element(tag,attrs,children.flat(Infinity).filter(child=>child!==null&&child!==undefined&&child!==false));
const ctx={el,button:(content,onClick,cls,attrs)=>el('button',{class:cls,onClick,...attrs},content),money:cents=>(cents/100).toFixed(2)};

test('all supported languages expose embedded flags with correct country mapping and text fallback',async()=>{
 const {productLanguages,productLanguagePresentation}=await ui;
 for(const code of Object.keys(productLanguages)){const view=productLanguagePresentation(code);assert.equal(view.label,productLanguages[code]);assert.ok(view.country);assert.match(view.flagUrl,/^data:image\/svg\+xml;charset=utf-8,/);const svg=decodeURIComponent(view.flagUrl.split(',')[1]);assert.match(svg,/<svg[^>]+viewBox="0 0 30 20"/);assert.doesNotMatch(svg,/<script|https?:\/\/(?!www.w3.org)/);}
 assert.equal(productLanguagePresentation('pt').country,'Brasil');assert.equal(productLanguagePresentation('ja').country,'Japão');assert.equal(productLanguagePresentation('en').country,'Estados Unidos');assert.equal(productLanguagePresentation('zh-tw').country,'Taiwan');
 assert.equal(productLanguagePresentation('xx').label,'xx');assert.equal(productLanguagePresentation('xx').flagUrl,'');assert.equal(productLanguagePresentation('').label,'Não informado');
});

test('physical card grades stay distinct and provide descriptions in Portuguese without changing stored codes',async()=>{
 const {productConditionPresentation}=await ui;
 for(const code of['M','NM','SP','MP','HP','D','LP','DMG']){const grade=productConditionPresentation(code);assert.equal(grade.code,code);assert.equal(grade.isCard,true);assert.ok(grade.label);assert.ok(grade.description);}
 assert.equal(productConditionPresentation('NM').description,'Sinais mínimos de manuseio');assert.equal(productConditionPresentation('SP').label,'Levemente jogada');assert.equal(productConditionPresentation('HP').label,'Muito jogada');assert.equal(productConditionPresentation('D').label,'Danificada');
 for(const code of['SEALED','OPENED','CUSTOM'])assert.equal(productConditionPresentation(code).isCard,false);
 assert.equal(productConditionPresentation('LEGACY').code,'LEGACY');assert.match(productConditionPresentation('LEGACY').description,/descrição e as fotos/);
});

test('variant choices expose flag, grade and attributes and update exact selected variant without losing codes',async()=>{
 const {createProductVariantChoice,setProductVariantChoiceSelected}=await ui;
 const variants=[{id:'nm',language:'pt',condition:'NM',finish:'HOLO',attributes:['PROMO'],priceCents:1000,stock:2},{id:'hp',language:'ja',condition:'HP',finish:'MASTER_BALL',attributes:[],priceCents:800,stock:1},{id:'soldout',language:'en',condition:'M',priceCents:2000,stock:0}];
 let chosen=variants[0];const choices=variants.map(variant=>createProductVariantChoice(ctx,variant,{selected:variant===chosen,onSelect:(next,event)=>{chosen=next;choices.forEach(choice=>setProductVariantChoiceSelected(choice,choice===event.currentTarget));}}));
 assert.match(choices[0].attrs['aria-label'],/Português.*NM — Near Mint.*Sinais mínimos.*Holo.*Promocional/);assert.equal(choices[0].attrs['aria-pressed'],'true');assert.equal(choices[1].attrs['aria-pressed'],'false');assert.match(choices[0].textContent,/NM.*Conservação.*Near Mint/);
 const flag=choices[0].all().find(node=>node.tag==='img');assert.equal(flag.attrs.alt,'');assert.equal(flag.attrs['aria-hidden'],'true');assert.match(flag.attrs.src,/data:image\/svg/);
 await choices[1].click();assert.equal(chosen.id,'hp');assert.equal(chosen.condition,'HP');assert.equal(chosen.language,'ja');assert.equal(choices[0].attrs['aria-pressed'],'false');assert.equal(choices[1].attrs['aria-pressed'],'true');assert.match(choices[1].className,/selected/);assert.doesNotMatch(choices[0].className,/selected/);
 await choices[2].click();assert.equal(chosen.id,'hp');assert.equal(choices[2].attrs.disabled,true);assert.match(choices[2].attrs['aria-label'],/indisponível/);
});

test('sealed and unknown variants remain readable without an invented physical card grade or flag',async()=>{
 const {createProductVariantChoice}=await ui;
 const sealed=createProductVariantChoice(ctx,{language:'en',condition:'SEALED',finish:'NORMAL',priceCents:2000,stock:1});assert.match(sealed.textContent,/Estado do produto.*Lacrado/);assert.equal(sealed.all().some(node=>node.attrs.class==='shop-condition-code'),false);
 const unknown=createProductVariantChoice(ctx,{language:'unknown',condition:'OLD',priceCents:100,stock:1});assert.match(unknown.textContent,/unknown.*OLD/);assert.equal(unknown.all().some(node=>node.tag==='img'),false);assert.doesNotMatch(unknown.textContent,/null|undefined/);
});
