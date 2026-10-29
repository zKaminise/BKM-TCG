const test=require('node:test'),assert=require('node:assert/strict');
const modulePromise=import('../personal-ui.js'),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
class Node{
 constructor(tag,props={},...children){this.tag=tag;this.value='';Object.assign(this,props);this.attributes={...props};this.children=[];this.events=new Map();this.append(...children);}
 append(...children){this.children.push(...children.flat(Infinity).filter(item=>item!==null&&item!==undefined));}
 replaceChildren(...children){this.children=[];this.append(...children);}
 setAttribute(key,value){this.attributes[key]=value;if(key==='id')this.id=value;}
 getAttribute(key){return this.attributes[key]??null;}
 addEventListener(type,handler){if(!this.events.has(type))this.events.set(type,new Set());this.events.get(type).add(handler);}
 removeEventListener(type,handler){this.events.get(type)?.delete(handler);}
 all(){return this.children.flatMap(child=>child instanceof Node?[child,...child.all()]:[]);}
 querySelector(selector){const name=selector.match(/^\[name="(.+)"\]$/)?.[1];return this.all().find(child=>name?child.name===name:child.tag===selector)||null;}
 get textContent(){return this.children.map(child=>child instanceof Node?child.textContent:String(child)).join(' ');}
 input(value){this.value=value;for(const handler of this.events.get('input')||[])handler({target:this});}
}
const fields=['zip','street','district','city','state','number','complement'];
const found={zip:'38408136',street:'Rua confirmada',district:'Bairro confirmado',city:'Uberlândia',state:'MG'};
async function fixture({initial={},api=async()=>({address:found}),delayMs=2}={}){
 const {createAccountAddressAutofill}=await modulePromise,form=new Node('form',{},fields.map(name=>new Node('input',{name,value:initial[name]||''}))),status=new Node('div');
 const editor=createAccountAddressAutofill({form,status,api,delayMs,message:(text,kind)=>new Node('p',{role:kind==='error'?'alert':'status'},text)});
 return{...editor,form,status,get:name=>form.querySelector(`[name="${name}"]`)};
}
test('account CEP fills the authoritative street, district, city and UF while preserving number and complement',async t=>{
 const calls=[],f=await fixture({initial:{number:'42',complement:'Sala 2'},api:async(route,options)=>{calls.push({route,options});return{address:found};}});t.after(f.destroy);
 f.get('zip').input('38408-136');await delay(15);
 assert.equal(calls[0].route,'/shipping/address?cep=38408136');for(const name of['street','district','city','state'])assert.equal(f.get(name).value,found[name]);
 assert.equal(f.get('number').value,'42');assert.equal(f.get('complement').value,'Sala 2');assert.match(f.status.textContent,/Endereço localizado/);assert.equal(f.get('zip').getAttribute('aria-busy'),'false');assert.ok(f.get('zip').getAttribute('aria-describedby'));
});
test('account CEP waits for eight digits and keeps manually editable fields after invalid CEP or provider failure',async t=>{
 let calls=0,fail=true;const f=await fixture({api:async()=>{calls++;if(fail)throw Error('CEP não encontrado. Confira o endereço.');return{address:found};}});t.after(f.destroy);
 f.get('zip').input('3840');await delay(10);assert.equal(calls,0);assert.match(f.status.textContent,/oito números/);
 f.get('zip').input('00000-000');await delay(10);assert.equal(calls,0);
 f.get('zip').input('38408-136');await delay(15);assert.equal(calls,1);assert.match(f.status.textContent,/CEP não encontrado/);assert.match(f.status.textContent,/manualmente/);
 f.get('street').input('Rua manual');assert.equal(f.get('street').disabled,undefined);fail=false;await f.lookupNow();assert.equal(f.get('city').value,'Uberlândia');
});
test('account CEP cancels stale lookup and clears only data linked to the previous CEP, including an edited saved address',async t=>{
 let resolveOld;const calls=[],f=await fixture({initial:{zip:'01001000',street:'Praça da Sé',district:'Sé',city:'São Paulo',state:'SP',number:'8',complement:'Casa'},api:async(route,{signal})=>{calls.push({route,signal});if(route.includes('38408136'))return new Promise(resolve=>resolveOld=resolve);return{address:{zip:'30140071',street:'Rua nova',district:'Savassi',city:'Belo Horizonte',state:'MG'}};}});t.after(f.destroy);
 f.get('zip').input('38408136');assert.equal(f.get('city').value,'');await delay(10);assert.ok(resolveOld);
 f.get('zip').input('30140071');assert.equal(calls[0].signal.aborted,true);await delay(15);resolveOld({address:found});await delay(1);
 assert.equal(f.get('city').value,'Belo Horizonte');assert.equal(f.get('street').value,'Rua nova');assert.equal(f.get('number').value,'8');assert.equal(f.get('complement').value,'Casa');
 f.get('street').input('Rua preservada');f.get('zip').input('3014');assert.equal(f.get('street').value,'Rua preservada');assert.equal(f.get('city').value,'');
});
test('manual edits during debounce or request are preserved and returning to a prior CEP performs a fresh fill',async t=>{
 let release;const f=await fixture({delayMs:15,api:async()=>new Promise(resolve=>release=resolve)});t.after(f.destroy);
 f.get('zip').input('38408136');f.get('street').input('Rua escrita durante espera');await delay(25);f.get('district').input('Bairro escrito durante consulta');release({address:found});await delay(1);
 assert.equal(f.get('street').value,'Rua escrita durante espera');assert.equal(f.get('district').value,'Bairro escrito durante consulta');assert.equal(f.get('city').value,'Uberlândia');
 f.get('zip').input('38408');assert.equal(f.get('city').value,'');f.get('zip').input('38408136');await delay(25);release({address:found});await delay(1);assert.equal(f.get('city').value,'Uberlândia');
});
test('CEP without a street explains manual completion and a response after closing the dialog cannot change the form',async()=>{
 const f=await fixture({api:async()=>({address:{zip:'38408136',city:'Uberlândia',state:'MG'}})});f.get('zip').input('38408136');await delay(15);assert.equal(f.get('street').value,'');assert.match(f.status.textContent,/não informou rua e bairro/);f.destroy();
 let release;const g=await fixture({api:async()=>new Promise(resolve=>release=resolve)});g.get('zip').input('38408136');await delay(10);g.destroy();release({address:found});await delay(1);assert.equal(g.get('city').value,'');
});
test('account CEP refuses a mismatched provider response without filling a different address',async t=>{
 const f=await fixture({api:async()=>({address:{...found,zip:'99999999'}})});t.after(f.destroy);f.get('zip').input('38408136');await delay(15);assert.equal(f.get('city').value,'');assert.match(f.status.textContent,/não confirmou/);
});
