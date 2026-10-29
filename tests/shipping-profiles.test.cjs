const test=require('node:test'),assert=require('node:assert/strict');
const {shippingSettings,validateShippingSettings,createShippingPolicy,hasConfiguredShipping,publicShippingSettings}=require('../server/shipping-policy.cjs');
const {packingPlan}=require('../server/shipping-packing.cjs');
class ApiError extends Error{constructor(status,code,message){super(message);Object.assign(this,{status,code});}}
const rate={enabled:true,priceCents:1000,estimatedDays:7,carrier:'Transportadora sintética',serviceName:'Serviço de teste',validated:true,validatedAt:'2026-01-01',cepRanges:[]};
const profile=(id,kinds,extras={})=>({id,name:'Perfil '+id,kinds,itemTypes:[],active:true,weightGrams:200,widthCm:12,heightCm:3,lengthCm:17,maxUnits:100,basePriceCents:200,...extras});
const settings=(extras={})=>shippingSettings({enabled:true,rateMode:'profile_table',freeShippingEnabled:true,freeShippingThresholdCents:15000,origin:{zip:'38400100',street:'Origem sintética',number:'1',district:'Centro',city:'Uberlândia',state:'MG'},packingProfiles:[profile('cards',['SINGLE']),profile('sealed',['SEALED'],{weightGrams:900,maxUnits:2,basePriceCents:500})],packingProfilesValidated:true,packingProfilesValidatedAt:'2026-01-01',regionRates:{SE:structuredClone(rate)},...extras});
const item=(kind='SINGLE',quantity=1,totalCents=1000,extra={})=>({kind,quantity,totalCents,...extra});
const destination=async url=>{const cep=url.match(/ws\/(\d{8})/)[1];return {ok:true,json:async()=>({cep,uf:cep.startsWith('69')?'AM':'SP',localidade:cep.startsWith('69')?'Manaus':'São Paulo',ibge:cep.startsWith('69')?'1302603':'3550308'})};};
const json=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
const meEnv={BKM_ENVIRONMENT:'production',SHIPPING_PROVIDER:'melhorenvio',MELHOR_ENVIO_ENABLED:'true',MELHOR_ENVIO_ENVIRONMENT:'production',MELHOR_ENVIO_TOKEN:'synthetic-test-token-never-live',MELHOR_ENVIO_USER_AGENT:'BKM fixtures (test@example.test)'};
const quoteRow=(id,price,days=5)=>({id,name:id===1?'PAC':'Expresso',custom_price:price,currency:'R$',custom_delivery_time:days,company:{name:id===1?'Correios':'Transportadora sintética'}});
const makePolicy=extras=>createShippingPolicy({ApiError,fetchImpl:destination,production:true,...extras});
const fail=(code,message)=>{throw new ApiError(422,code,message);};
const store={city:'Uberlândia',state:'MG',whatsapp:'5534999999999'};

test('manual profile tariff uses state override, region fallback and quantity-aware packed capacities',async()=>{
 const s=settings({freeShippingEnabled:false}),policy=makePolicy();
 let q=await policy.quote({settings:s,netCents:1000,cep:'01001000',items:[item()]});
 assert.equal(q.shippingCents,1200);assert.equal(q.volumeCount,1);assert.equal(q.selectedOptionId,'store:profile:SP');assert.deepEqual(q.packing,[{profileId:'cards',name:'Perfil cards',quantity:1,volumes:1}]);
 q=await policy.quote({settings:s,netCents:1000,cep:'01001000',items:[item('SINGLE',101)]});assert.equal(q.shippingCents,2400);assert.equal(q.volumeCount,2);
 s.stateRates.SP={...rate,priceCents:800};q=await policy.quote({settings:s,netCents:1000,cep:'01001000',items:[item()]});assert.equal(q.shippingCents,1000);
 s.stateRates.SP={enabled:false};q=await policy.quote({settings:s,netCents:90000,cep:'01001000',items:[item()]});assert.equal(q.available,false);assert.equal(q.shippingCents,null);
 delete s.stateRates.SP;q=await policy.quote({settings:s,netCents:1000,cep:'01001000',items:[item()]});assert.equal(q.shippingCents,1200);
});

test('mixed and sealed subtype profiles choose the measured class and total all volumes without product weights',()=>{
 const s=settings();s.packingProfiles.push(profile('etb',['SEALED'],{itemTypes:['ETB'],maxUnits:1,weightGrams:1200,basePriceCents:900}));
 const plan=packingPlan(s,[item('SINGLE',101,5000),item('SEALED',3,25000,{productAttributes:{itemType:'ETB'}}),item('SEALED',1,2000,{itemType:'BOOSTER'})],30001);
 assert.equal(plan.available,true);assert.equal(plan.volumeCount,6);assert.deepEqual(plan.summary.map(r=>[r.profileId,r.volumes]),[['cards',2],['etb',3],['sealed',1]]);
 assert.deepEqual(plan.volumes.map(r=>r.weightGrams),[200,200,1200,1200,1200,900]);assert.equal(plan.volumes.reduce((n,r)=>n+r.insuranceValueCents,0),30001);
});

test('missing class, unchecked packing and excessive volumes fail closed; pickup remains independent',async()=>{
 const policy=makePolicy(),s=settings();
 for(const input of[[item('CUSTOM')],[item('SINGLE',2001)],[{...item(),quantity:1.5}]]){const q=await policy.quote({settings:s,netCents:90000,cep:'01001000',items:input});assert.equal(q.available,false);assert.equal(q.shippingCents,null);}
 s.packingProfilesValidated=false;assert.equal((await policy.quote({settings:s,netCents:90000,cep:'01001000',items:[item()]})).available,false);
 s.pickup.enabled=true;const pickup=await policy.quote({settings:s,netCents:1000,deliveryMode:'pickup',items:[item('CUSTOM')]});assert.equal(pickup.shippingCents,0);
});

test('free-shipping threshold uses net amount and never expands an unavailable state or CEP range',async()=>{
 const policy=makePolicy(),s=settings();
 assert.equal((await policy.quote({settings:s,netCents:14999,cep:'01001000',items:[item()]})).shippingCents,1200);
 const free=await policy.quote({settings:s,netCents:15000,cep:'01001000',items:[item()]});assert.equal(free.shippingCents,0);assert.equal(free.remainingForFreeShippingCents,0);
 assert.equal((await policy.quote({settings:s,netCents:90000,cep:'69005000',items:[item()]})).available,false);
 s.stateRates.SP={...rate,cepRanges:[{start:'01001000',end:'01001999'}]};
 for(const cep of['01001000','01001999'])assert.equal((await policy.quote({settings:s,netCents:1000,cep,items:[item()]})).available,true);
 for(const cep of['01000999','01002000'])assert.equal((await policy.quote({settings:s,netCents:90000,cep,items:[item()]})).available,false);
});

test('carrier quote uses all measured volumes and authoritative price, supports selection and economic free-shipping benefit',async()=>{
 let calls=0,payload;const s=settings({rateMode:'melhorenvio'}),policy=makePolicy({env:meEnv,carrierFetch:async(url,init)=>{calls++;assert.equal(url,'https://melhorenvio.com.br/api/v2/me/shipment/calculate');payload=JSON.parse(init.body);return json([quoteRow(2,'25.00',2),quoteRow(1,'15.00',7)]);}});
 let q=await policy.quote({settings:s,netCents:14999,cep:'01001000',items:[item('SINGLE',101)]});
 assert.equal(q.shippingCents,1500);assert.equal(q.selectedOptionId,'melhorenvio:1');assert.equal(q.options.length,2);assert.equal(q.demo,false);assert.equal(payload.volumes.length,2);assert.equal(payload.volumes[0].weight,.2);assert.equal(payload.volumes.reduce((n,r)=>n+Math.round(r.insurance*100),0),14999);assert.equal(payload.products,undefined);
 q=await policy.quote({settings:s,netCents:14999,cep:'01001000',items:[item('SINGLE',101)],shippingOptionId:'melhorenvio:2',shippingCents:1});assert.equal(q.shippingCents,2500);assert.equal(calls,1,'selection reuses bounded cache, never trusts posted prices');
 q=await policy.quote({settings:s,netCents:15000,cep:'01001000',items:[item('SINGLE',101)],shippingOptionId:'melhorenvio:2'});assert.equal(q.shippingCents,1000);assert.equal(q.shippingBenefitCents,1500);assert.equal(q.free,false);assert.equal(q.options[0].priceCents,0);assert.equal(q.options[1].originalPriceCents,2500);
 await assert.rejects(policy.quote({settings:s,netCents:15000,cep:'01001000',items:[item()],shippingOptionId:'melhorenvio:99'}),{code:'SHIPPING_OPTION_CHANGED'});
});

test('carrier cache expires, coalesces concurrent calls and separates destination and packing changes',async()=>{
 let calls=0,clock=Date.now();const policy=makePolicy({env:meEnv,now:()=>clock,carrierFetch:async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,5));return json([quoteRow(1,'15.00')]);}}),s=settings({rateMode:'melhorenvio'});
 const input={settings:s,netCents:1000,cep:'01001000',items:[item()]};await Promise.all([policy.quote(input),policy.quote(input),policy.quote(input)]);assert.equal(calls,1);
 await policy.quote({...input,cep:'01001999'});assert.equal(calls,2);
 await policy.quote({...input,items:[item('SINGLE',101)]});assert.equal(calls,3);
 clock+=120001;await policy.quote(input);assert.equal(calls,4);
});

test('production never accepts sandbox carrier configuration and provider failures never invent options',async()=>{
 const s=settings({rateMode:'melhorenvio'});let calls=0;
 for(const env of[{}, {...meEnv,MELHOR_ENVIO_ENVIRONMENT:'sandbox'}]){const policy=makePolicy({env,carrierFetch:async()=>{calls++;return json([quoteRow(1,'1.00')]);}});const q=await policy.quote({settings:s,netCents:90000,cep:'01001000',items:[item()]});assert.equal(q.available,false);assert.equal(q.shippingCents,null);assert.equal(hasConfiguredShipping(s,{production:true,env}),false);}
 assert.equal(calls,0);
 for(const carrierFetch of[async()=>json([]),async()=>json([{id:1,error:'private failure'}]),async()=>{throw Error('private token failure');}]){const q=await makePolicy({env:meEnv,carrierFetch}).quote({settings:s,netCents:90000,cep:'01001000',items:[item()]});assert.equal(q.available,false);assert.equal(q.shippingCents,null);assert(!JSON.stringify(q).includes('private'));}
 const sandbox=makePolicy({production:false,env:{...meEnv,BKM_ENVIRONMENT:'sandbox',MELHOR_ENVIO_ENVIRONMENT:'sandbox'},carrierFetch:async()=>json([quoteRow(1,'15.00')])});const q=await sandbox.quote({settings:s,netCents:1000,cep:'01001000',items:[item()]});assert.equal(q.demo,true);assert.equal(q.options[0].sandbox,true);
});

test('admin validates measured profiles, state rates and environment, and keeps operational data private',()=>{
 const s=settings(),current=shippingSettings();const validate=(input=s,env={})=>validateShippingSettings(input,current,{fail,store,env});
 assert.equal(validate().packingProfiles[0].maxUnits,100);assert.equal(validate().freeShippingThresholdCents,15000);
 for(const change of[v=>v.packingProfiles=null,v=>v.stateRates=null,v=>v.stateRates.XX=rate,v=>v.packingProfiles[0].weightGrams=0,v=>v.packingProfiles[0].maxUnits=0,v=>v.packingProfiles[0].basePriceCents=-1,v=>v.packingProfiles[0].widthCm=1.01,v=>v.packingProfiles[0].kinds=['UNKNOWN'],v=>v.packingProfilesValidatedAt='2099-01-01',v=>v.stateRates.SP={...rate,validated:false},v=>v.stateRates.SP={...rate,estimatedDays:0}]){const bad=structuredClone(s);change(bad);assert.throws(()=>validate(bad),{code:'VALIDATION'});}
 const saved=validate();assert.throws(()=>validateShippingSettings({packingProfiles:[{...s.packingProfiles[0],weightGrams:300}]},saved,{fail,store}),/Confirme novamente/);
 const carrier=settings({rateMode:'melhorenvio'});assert.throws(()=>validate(carrier),/credencial/);assert.throws(()=>validate(carrier,{...meEnv,MELHOR_ENVIO_ENVIRONMENT:'sandbox'}),/ambiente correto/);assert.equal(validate(carrier,meEnv).rateMode,'melhorenvio');
 const dto=publicShippingSettings(s);for(const key of['origin','packingProfiles','packingProfilesValidatedAt','stateRates'])assert.equal(dto[key],undefined);
});

test('API checkout derives packing from saved product, persists chosen carrier and rejects idempotency service changes',async t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),{once}=require('node:events'),{createServer}=require('../serve.cjs'),{hashPassword}=require('../server/auth.cjs');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'bkm-profile-api-'));let payload,calls=0;
 const server=createServer({root:directory,dbPath:path.join(directory,'isolated.sqlite'),databaseUrl:'',env:{...meEnv,BKM_ENVIRONMENT:'demo',MELHOR_ENVIO_ENVIRONMENT:'sandbox',PAYMENT_PROVIDER:'mock',EMAIL_PROVIDER:'disabled'},shippingFetch:destination,shippingProviderFetch:async(url,init)=>{calls++;payload=JSON.parse(init.body);return json([quoteRow(1,'15.00'),quoteRow(2,'25.00',2)]);}});
 await server.api.ready;server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await server.api.close();fs.rmSync(directory,{recursive:true,force:true});});
 const db=server.api.asyncStore,base='http://127.0.0.1:'+server.address().port;let cookie='',csrf='';
 async function call(route,{method='GET',body}={}){const response=await fetch(base+route,{method,headers:{cookie,'x-csrf-token':csrf,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];const data=await response.json();if(data.csrfToken)csrf=data.csrfToken;return {status:response.status,data};}
 await db.prepare("INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,'ADMIN',?)").run(crypto.randomUUID(),'shipping-api@example.test','Admin sintético',await hashPassword('Legacy-test-password'),new Date().toISOString());
 await call('/api/session');assert.equal((await call('/api/auth/login',{method:'POST',body:{email:'shipping-api@example.test',password:'Legacy-test-password'}})).status,200);
 const s=settings({rateMode:'melhorenvio',freeShippingEnabled:false});s.packingProfiles.push(profile('etb',['SEALED'],{itemTypes:['ETB'],maxUnits:1,weightGrams:1200}));
 const saved=await call('/api/admin/settings',{method:'PUT',body:{shipping:s}});assert.equal(saved.status,200,JSON.stringify(saved.data));
 const p=await call('/api/admin/products',{method:'POST',body:{kind:'SEALED',name:'ETB sintética',attributes:{itemType:'ETB'},images:[{url:'/assets/pack.webp',kind:'reference'}],published:true,variants:[{language:'pt',condition:'SEALED',finish:'NORMAL',priceCents:1000,stock:5}]}});assert.equal(p.status,201,JSON.stringify(p.data));
 const items=[{variantId:p.data.variants[0].id,quantity:2,kind:'SINGLE',weightGrams:1}],input={items,cep:'01001000',shippingOptionId:'melhorenvio:2',shippingCents:1};
 const q=await call('/api/checkout/quote',{method:'POST',body:input});assert.equal(q.status,200,JSON.stringify(q.data));assert.equal(q.data.items[0].kind,'SEALED');assert.equal(q.data.items[0].productAttributes.itemType,'ETB');assert.equal(q.data.shipping.packing[0].profileId,'etb');assert.equal(payload.volumes.length,2);assert.equal(payload.volumes[0].weight,1.2);assert.equal(q.data.shippingCents,2500);assert.equal(q.data.totalCents,4500);assert.equal(q.data.shipping.demo,true);
 const checkout={...input,idempotencyKey:crypto.randomUUID(),contact:{name:'Admin sintético',email:'shipping-api@example.test'},address:{zip:'01001000',street:'Rua sintética',number:'1',district:'Centro',city:'São Paulo',state:'SP'},payment:{provider:'mock',outcome:'pending'}};
 const created=await call('/api/checkout',{method:'POST',body:checkout});assert.equal(created.status,201,JSON.stringify(created.data));assert.equal(created.data.order.shippingCents,2500);assert.equal(created.data.order.shipping.selectedOptionId,'melhorenvio:2');assert.equal(created.data.order.shipping.carrier,'Transportadora sintética');assert.equal(calls,1);
 const retry=await call('/api/checkout',{method:'POST',body:checkout});assert.equal(retry.status,201);assert.equal(retry.data.order.id,created.data.order.id);
 const conflict=await call('/api/checkout',{method:'POST',body:{...checkout,shippingOptionId:'melhorenvio:1'}});assert.equal(conflict.status,409);assert.equal(conflict.data.error.code,'IDEMPOTENCY_CONFLICT');
 const invalid=await call('/api/checkout/quote',{method:'POST',body:{...input,shippingOptionId:'melhorenvio:99'}});assert.equal(invalid.status,422);assert.equal(invalid.data.error.code,'SHIPPING_OPTION_CHANGED');
});
