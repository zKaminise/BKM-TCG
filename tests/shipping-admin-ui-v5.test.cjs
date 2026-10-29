const test=require('node:test'),assert=require('node:assert/strict');
const modulePromise=import('../shipping-admin-ui.js');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
class Element{
 constructor(tag,props={},children=[]){this.tag=tag;this.attributes={};this.dataset={};this.children=[];this.listeners=new Map();this.value='';this.checked=false;this.disabled=false;for(const[key,value]of Object.entries(props)){if(/^on[A-Z]/.test(key))this.addEventListener(key.slice(2).toLowerCase(),value);else this.setAttribute(key,value);}this.append(...children);}
 setAttribute(key,value){this.attributes[key]=value;if(key.startsWith('data-'))this.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=String(value);else this[key]=value;}
 getAttribute(key){return key.startsWith('data-')?this.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]??null:this.attributes[key]??null;}
 removeAttribute(key){delete this.attributes[key];}
 append(...children){for(const child of children.flat(Infinity)){this.children.push(child instanceof Element?child:String(child));if(child instanceof Element)child.parentNode=this;}}
 replaceChildren(...children){this.children=[];this.append(...children);}
 remove(){this.parentNode.children=this.parentNode.children.filter(child=>child!==this);}
 get textContent(){return this.children.map(child=>child instanceof Element?child.textContent:child).join(' ');}
 set textContent(text){this.children=[String(text)];}
 all(){return this.children.flatMap(child=>child instanceof Element?[child,...child.all()]:[]);}
 querySelectorAll(selector){return this.all().filter(node=>{const attr=selector.match(/^\[([^\]=]+)(\$)?(?:="([^"]*)")?\]$/);if(attr){const key=attr[1],actual=key.startsWith('data-')?node.getAttribute(key):node[key]??node.getAttribute(key);return attr[3]===undefined?actual!==null&&actual!==undefined:attr[2]?String(actual||'').endsWith(attr[3]):String(actual||'')===attr[3];}if(selector.startsWith('.'))return String(node.class||'').split(/\s+/).includes(selector.slice(1));return node.tag===selector;});}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 addEventListener(type,handler){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(handler);}
 async fire(type){const event={type,target:this,currentTarget:this,preventDefault(){}};for(let node=this;node;node=node.parentNode){event.currentTarget=node;for(const handler of node.listeners.get(type)||[])await handler(event);}}
 async click(){if(this.tag==='input'&&this.type==='checkbox'){this.checked=!this.checked;await this.fire('change');}await this.fire('click');}
}
const el=(tag,props={},...children)=>new Element(tag,props,children.flat(Infinity).filter(value=>value!==null&&value!==undefined&&value!==false));
const get=(screen,name)=>screen.all().find(node=>['input','textarea','select'].includes(node.tag)&&node.name===name);
const type=async(node,value)=>{assert.ok(node);node.value=value;await node.fire(node.tag==='select'?'change':'input');};
const button=(screen,text)=>screen.all().find(node=>node.tag==='button'&&node.textContent===text);
async function fixture(shipping={},api=async()=>{throw Error('Sem consulta configurada');}){
 const {createShippingAdminEditor}=await modulePromise;
 const ctx={el,api,field:(text,name,type,value,extra={})=>el('label',{},el('span',{},text),el(type==='textarea'?'textarea':'input',{name,type,value,...extra})),selectField:(text,name,options,value,extra={})=>el('label',{},el('span',{},text),el('select',{name,value,...extra},options.map(([id,text])=>el('option',{value:id},text)))),checkbox:(text,name,checked)=>el('label',{},el('input',{name,type:'checkbox',checked}),el('span',{},text)),button:(text,onClick,cls,extra={})=>el('button',{type:'button',class:cls,onClick,...extra},text),message:(text,kind)=>el('p',{role:kind==='error'?'alert':'status'},text)};
 const editor=createShippingAdminEditor({ctx,shipping,production:true});return{...editor,screen:editor.element};
}
const rate={enabled:true,carrier:'Correios',serviceName:'PAC',priceCents:2000,estimatedDays:5,validated:true,validatedAt:'2026-01-01',cepRanges:[]};
const profile={id:'cards',name:'Cartas protegidas',active:true,kinds:['SINGLE'],itemTypes:[],maxUnits:20,basePriceCents:500,weightGrams:150,widthCm:15,heightCm:3,lengthCm:20};
const configured={enabled:true,rateMode:'profile_table',origin:{zip:'38400000',street:'Rua inicial',number:'42',complement:'Sala 2',district:'Centro',city:'Uberlândia',state:'MG'},packingProfiles:[profile],packingProfilesValidated:true,packingProfilesValidatedAt:'2026-01-01',stateRates:{SP:rate},regionRates:{SE:{...rate,priceCents:1500}},freeShippingEnabled:true,freeShippingThresholdCents:15000,pickup:{enabled:true},localDelivery:{enabled:true,estimatedDays:null}};

test('CEP lookup rejects stale responses, aborts previous work and stops on disposal',async()=>{
 const {createShippingOriginLookup}=await modulePromise,calls=[],addresses=[],statuses=[];let resolveFirst;
 const lookup=createShippingOriginLookup({delayMs:3,api:async(route,{signal})=>{calls.push({route,signal});if(route.includes('38400000'))return new Promise(resolve=>resolveFirst=resolve);return{address:{zip:'01001000',street:'Praça da Sé',district:'Sé',city:'São Paulo',state:'SP'}};},onAddress:value=>addresses.push(value),onStatus:value=>statuses.push(value)});
 lookup.schedule('38400-000');await delay(10);lookup.schedule('01001-000');assert.equal(calls[0].signal.aborted,true);await delay(10);resolveFirst({address:{zip:'38400000',city:'Uberlândia',state:'MG'}});await delay(1);assert.equal(addresses.length,1);assert.equal(addresses[0].city,'São Paulo');assert.ok(statuses.includes('loading'));assert.equal(statuses.at(-1),'success');lookup.schedule('38401000');lookup.destroy();await delay(10);assert.equal(calls.length,2);
});
test('CEP lookup validates authoritative address and exposes provider errors instead of inventing data',async()=>{
 const {createShippingOriginLookup}=await modulePromise,errors=[],addresses=[];const lookup=createShippingOriginLookup({api:async()=>({address:{zip:'99999999',city:'Cidade',state:'MG'}}),onAddress:address=>addresses.push(address),onError:error=>errors.push(error.message)});await lookup.lookupNow('38400000');assert.equal(addresses.length,0);assert.match(errors[0],/não confirmou/);lookup.destroy();
});
test('origin autofill preserves number, complement and fields edited during an in-flight lookup',async t=>{
 let release;const f=await fixture(configured,async()=>new Promise(resolve=>release=resolve));t.after(f.destroy);const s=f.screen;
 const pending=button(s,'Consultar CEP de origem').click();await delay(0);await type(get(s,'shippingOriginstreet'),'Rua digitada manualmente');release({address:{zip:'38400000',street:'Rua vinda do CEP',district:'Bairro confirmado',city:'Uberlândia',state:'MG'}});await pending;
 assert.equal(get(s,'shippingOriginstreet').value,'Rua digitada manualmente');assert.equal(get(s,'shippingOrigindistrict').value,'Bairro confirmado');assert.equal(get(s,'shippingOriginnumber').value,'42');assert.equal(get(s,'shippingOrigincomplement').value,'Sala 2');assert.equal(get(s,'packingProfilesValidated').checked,false);assert.equal(get(s,'shippingStateSPValidated').checked,false);assert.equal(get(s,'shippingOriginzip').getAttribute('aria-busy'),'false');assert.match(s.textContent,/CEP consultado/);
});
test('empty settings do not manufacture profiles, weights, tariffs or a new free-shipping threshold',async t=>{
 const f=await fixture({enabled:false,freeShippingEnabled:true,freeShippingThresholdCents:15000,pickup:{enabled:true},localDelivery:{enabled:true}});t.after(f.destroy);const data=f.read();assert.equal(data.rateMode,'profile_table');assert.deepEqual(data.packingProfiles,[]);assert.deepEqual(data.stateRates,{});assert.deepEqual(data.packages,[]);assert.equal(data.freeShippingThresholdCents,15000);assert.equal(data.pickup.enabled,true);assert.equal(data.localDelivery.enabled,true);assert.equal(Object.values(data.regionRates).some(rate=>rate.enabled),false);assert.equal(Object.values(data.regionRates).every(rate=>rate.priceCents===null&&rate.estimatedDays===null),true);
});
test('profile and state editor round-trips cents, capacities and explicit UF inheritance/blocking',async t=>{
 const f=await fixture(configured);t.after(f.destroy);const s=f.screen,data=f.read();assert.deepEqual(data.packingProfiles,[profile]);assert.equal(data.stateRates.SP.priceCents,2000);assert.equal(data.regionRates.SE.priceCents,1500);assert.equal(data.packingProfilesValidated,true);assert.equal(data.stateRates.MG,undefined);assert.match(s.textContent,/× volumes/);assert.equal(s.querySelector('.bkm-shipping-state-rates').children.every(row=>!row.open),true);
 await type(get(s,'shippingStateMGMode'),'off');let changed=f.read();assert.equal(changed.stateRates.MG.enabled,false);await type(get(s,'shippingStateSPMode'),'region');changed=f.read();assert.equal(changed.stateRates.SP,undefined);await type(get(s,'freeShippingThreshold'),'200.00');assert.equal(f.read().freeShippingThresholdCents,20000);
});
test('changing a packing profile invalidates tariff and packing confirmations; the mode never silently activates national shipping',async t=>{
 const f=await fixture(configured);t.after(f.destroy);const s=f.screen;await type(get(s,'shippingProfile1Weight'),'250');assert.equal(get(s,'packingProfilesValidated').checked,false);assert.equal(get(s,'shippingStateSPValidated').checked,false);assert.throws(()=>f.read(),/confirme/);await type(get(s,'rateMode'),'melhorenvio');assert.equal(s.querySelector('.bkm-shipping-state-panel').hidden,true);assert.equal(s.querySelector('.bkm-shipping-profile-panel').hidden,false);assert.match(s.textContent,/credencial de produção/);assert.equal(get(s,'shippingEnabled').checked,true); // unchanged explicit preexisting flag, never toggled by changing mode
});
test('a profile template contains no invented weight, capacity or surcharge and requires explicit operational values',async t=>{
 const f=await fixture({enabled:false,rateMode:'profile_table'});t.after(f.destroy);const s=f.screen;await button(s,'Adicionar perfil de cartas').click();assert.equal(get(s,'shippingProfile1Name').value,'Cartas avulsas');assert.equal(get(s,'shippingProfile1Weight').value,'');assert.equal(get(s,'shippingProfile1MaxUnits').value,'');assert.equal(get(s,'shippingProfile1BasePrice').value,'');assert.throws(()=>f.read(),/capacidade/);for(const [suffix,value]of[['MaxUnits','20'],['BasePrice','0'],['Weight','150'],['Width','15'],['Height','3'],['Length','20']])await type(get(s,'shippingProfile1'+suffix),value);const data=f.read();assert.equal(data.packingProfiles[0].basePriceCents,0);assert.equal(data.packingProfiles[0].maxUnits,20);assert.deepEqual(data.packingProfiles[0].kinds,['SINGLE']);assert.equal(data.enabled,false);
});
test('ME mode preserves invalidated manual rates without requiring fields hidden in the selected mode',async t=>{
 const f=await fixture({...configured,rateMode:'melhorenvio',stateRates:{SP:{...rate,validated:false}},regionRates:{SE:{...rate,validated:false}}});t.after(f.destroy);const s=f.screen,data=f.read();assert.equal(data.rateMode,'melhorenvio');assert.equal(data.stateRates.SP.validated,false);assert.equal(data.regionRates.SE.validated,false);assert.equal(get(s,'shippingStateSPPrice').required,false);assert.equal(get(s,'shippingStateSPPrice').disabled,true);await type(get(s,'rateMode'),'profile_table');assert.throws(()=>f.read(),/confirme/);assert.equal(get(s,'shippingStateSPPrice').required,true);
});
test('CEP lookup waits for eight digits, accepts masked CEP and avoids duplicate successful auto-lookups',async()=>{
 const {createShippingOriginLookup}=await modulePromise,calls=[];const lookup=createShippingOriginLookup({delayMs:2,api:async route=>{calls.push(route);return{address:{zip:'38400000',city:'Uberlândia',state:'MG'}};}});lookup.schedule('3840');await delay(5);assert.equal(calls.length,0);lookup.schedule('38400-000');await delay(6);assert.equal(calls.length,1);lookup.schedule('38400000');await delay(6);assert.equal(calls.length,1);lookup.destroy();
});
test('a CEP without street or district keeps manual fields available and explains the missing data',async t=>{
 const f=await fixture(configured,async()=>({address:{zip:'38400000',city:'Uberlândia',state:'MG'}}));t.after(f.destroy);await button(f.screen,'Consultar CEP de origem').click();assert.equal(get(f.screen,'shippingOriginstreet').value,'Rua inicial');assert.equal(get(f.screen,'shippingOriginstreet').disabled,false);assert.match(f.screen.textContent,/não informou rua e bairro; preencha manualmente/);assert.ok(get(f.screen,'shippingOriginzip').getAttribute('aria-describedby'));
});
