const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {once}=require('node:events');
const {shippingSettings,validateShippingSettings,createShippingPolicy,hasConfiguredShipping,REGION_STATES}=require('../server/shipping-policy.cjs');
class ApiError extends Error{constructor(status,code,message){super(message);Object.assign(this,{status,code});}}
const destinations={
  '38400100':{cep:'38400-100',localidade:'Uberlândia',uf:'MG',ibge:'3170206',logradouro:'Avenida de teste',bairro:'Centro'},
  '01001000':{cep:'01001-000',localidade:'São Paulo',uf:'SP',ibge:'3550308'},
  '69005000':{cep:'69005-000',localidade:'Manaus',uf:'AM',ibge:'1302603'},
  '40020000':{cep:'40020-000',localidade:'Salvador',uf:'BA',ibge:'2927408'},
  '70040900':{cep:'70040-900',localidade:'Brasília',uf:'DF',ibge:'5300108'},
  '90010000':{cep:'90010-000',localidade:'Porto Alegre',uf:'RS',ibge:'4314902'}
};
const transport=async url=>({ok:true,json:async()=>destinations[url.match(/ws\/(\d{8})/)[1]]||{erro:true}});
const rates=Object.fromEntries(Object.keys(REGION_STATES).map((id,index)=>[id,{enabled:true,priceCents:1000+index*100,estimatedDays:10-index}]));
const policySettings=()=>shippingSettings({enabled:true,rateMode:'regional',regionRates:rates,freeShippingEnabled:true,freeShippingThresholdCents:15000,pickup:{enabled:true},localDelivery:{enabled:true,estimatedDays:1}});

test('frete regional usa UF verificada, identifica as cinco regiões e calcula mínimo depois do desconto',async()=>{
  const policy=createShippingPolicy({ApiError,fetchImpl:transport,production:true});
  await assert.rejects(policy.quote({settings:policySettings(),cep:'01001000',netCents:1000,address:null}),error=>error.code==='ADDRESS');
  for(const [cep,id] of [['69005000','N'],['40020000','NE'],['70040900','CO'],['01001000','SE'],['90010000','S']]){
    const quote=await policy.quote({settings:policySettings(),cep,netCents:14999});
    assert.equal(quote.available,true);assert.equal(quote.regionId,id);assert.equal(quote.shippingCents,rates[id].priceCents);assert.equal(quote.estimatedDays,rates[id].estimatedDays);assert.equal(quote.remainingForFreeShippingCents,1);
    const free=await policy.quote({settings:policySettings(),cep,netCents:15000});assert.equal(free.shippingCents,0);assert.equal(free.free,true);
  }
});
test('cidade e UF digitadas não permitem entrega local grátis para um CEP de outra cidade',async()=>{
  const policy=createShippingPolicy({ApiError,fetchImpl:transport,production:true});
  await assert.rejects(policy.quote({settings:policySettings(),cep:'01001000',netCents:1000,address:{city:'Uberlândia',state:'MG'}}),error=>error.code==='ADDRESS_CEP_MISMATCH');
  const noSpoof=await policy.quote({settings:policySettings(),cep:'01001000',netCents:1000,deliveryMode:'local'});assert.equal(noSpoof.available,false);assert.equal(noSpoof.shippingCents,null);
  const local=await policy.quote({settings:policySettings(),cep:'38400100',netCents:1000,address:{city:'Uberlandia',state:'mg'}});assert.equal(local.deliveryMode,'local');assert.equal(local.free,true);assert.equal(local.shippingCents,0);assert.equal(local.destination.ibge,'3170206');
  const unpromised=policySettings();unpromised.localDelivery.estimatedDays=null;const arranged=await policy.quote({settings:unpromised,cep:'38400100',netCents:1000});assert.equal(arranged.available,true);assert.equal(arranged.estimatedDays,null);assert.equal(arranged.deliveryMode,'local');
  const wrongIbge=createShippingPolicy({ApiError,production:true,fetchImpl:async()=>({ok:true,json:async()=>({...destinations['38400100'],ibge:'3106200'})})});
  const result=await wrongIbge.quote({settings:policySettings(),cep:'38400100',netCents:1000,deliveryMode:'local'});assert.equal(result.available,false);
});
test('retirada precisa estar habilitada, dispensa CEP e não depende de cotação externa',async()=>{
  let lookups=0;const policy=createShippingPolicy({ApiError,production:true,fetchImpl:async()=>{lookups++;throw new Error('rede indisponível');}});
  const disabled=await policy.quote({settings:shippingSettings(),netCents:1000,deliveryMode:'pickup'});assert.equal(disabled.available,false);assert.equal(disabled.shippingCents,null);
  const pickup=await policy.quote({settings:policySettings(),netCents:1000,deliveryMode:'pickup'});assert.equal(pickup.available,true);assert.equal(pickup.shippingCents,0);assert.equal(pickup.deliveryMode,'pickup');assert.equal(lookups,0);
  await assert.rejects(policy.quote({settings:policySettings(),netCents:1000,deliveryMode:'qualquer'}),error=>error.code==='SHIPPING_METHOD');
});
test('CEP inexistente, lookup falho e região desabilitada falham sem preço inventado',async()=>{
  const policy=createShippingPolicy({ApiError,production:true,fetchImpl:transport});
  await assert.rejects(policy.quote({settings:policySettings(),netCents:1000,cep:'99999999'}),error=>error.code==='INVALID_CEP');
  await assert.rejects(policy.quote({settings:policySettings(),netCents:1000,cep:'123'}),error=>error.code==='INVALID_CEP');
  const wrong=createShippingPolicy({ApiError,production:true,fetchImpl:async()=>({ok:true,json:async()=>({...destinations['01001000'],cep:'38400-100'})})});
  await assert.rejects(wrong.quote({settings:policySettings(),netCents:1000,cep:'01001000'}),error=>error.status===503&&error.code==='SHIPPING_LOOKUP_UNAVAILABLE');
  const offline=createShippingPolicy({ApiError,production:true,fetchImpl:async()=>{throw new Error('timeout with private transport details');}});
  await assert.rejects(offline.quote({settings:policySettings(),netCents:1000,cep:'01001000'}),error=>error.status===503&&!error.message.includes('private'));
  const s=policySettings();s.regionRates.SE.enabled=false;const disabled=await policy.quote({settings:s,netCents:99999,cep:'01001000'});assert.equal(disabled.available,false);assert.equal(disabled.shippingCents,null);
  const legacy=await policy.quote({settings:{enabled:true,rateMode:'flat',flatRateCents:1},netCents:1000,cep:'01001000'});assert.equal(legacy.available,false);assert.equal(hasConfiguredShipping({enabled:true,rateMode:'flat'},{production:true}),false);
});
test('destino tem cache limitado por tempo; alterações de preço/configuração são aplicadas em cada cotação',async()=>{
  let calls=0,clock=1000;const policy=createShippingPolicy({ApiError,production:true,now:()=>clock,fetchImpl:async url=>{calls++;return transport(url);}}),s=policySettings();
  assert.equal((await policy.quote({settings:s,netCents:1000,cep:'01001000'})).shippingCents,1300);
  s.regionRates.SE={enabled:true,priceCents:2500,estimatedDays:2};assert.equal((await policy.quote({settings:s,netCents:1000,cep:'01001000'})).shippingCents,2500);assert.equal(calls,1);
  clock+=3600001;await policy.quote({settings:s,netCents:1000,cep:'01001000'});assert.equal(calls,2);
});
test('admin precisa informar preço/prazo de região ativa e contato real para retirada/local',()=>{
  const fail=(code,message)=>{throw new ApiError(422,code,message);},current=shippingSettings(),store={address:'',city:'Uberlândia',state:'MG',whatsapp:'5534999999999'};
  const validate=input=>validateShippingSettings(input,current,{fail,store});
  assert.throws(()=>validate({rateMode:'regional',regionRates:{SE:{enabled:true,priceCents:null,estimatedDays:5}}}),error=>error.code==='VALIDATION');
  assert.throws(()=>validate({regionRates:{XX:{enabled:true,priceCents:0,estimatedDays:0}}}),error=>error.code==='VALIDATION');
  for(const input of [{regionRates:null},{regionRates:{SE:null}},{regionRates:{SE:{custom:true}}},{pickup:'true'},{pickup:{enabled:true,custom:true}},{localDelivery:null}])assert.throws(()=>validate(input),error=>error.code==='VALIDATION');
  assert.throws(()=>validateShippingSettings({pickup:{enabled:true}},current,{fail,store:{}}),error=>error.code==='VALIDATION');
  assert.throws(()=>validateShippingSettings({localDelivery:{enabled:true,estimatedDays:1}},current,{fail,store:{...store,city:'São Paulo',state:'SP'}}),error=>error.code==='VALIDATION');
  assert.equal(validate({localDelivery:{enabled:true,estimatedDays:null}}).localDelivery.estimatedDays,null);
  for(const estimatedDays of [-1,0.5,'1'])assert.throws(()=>validate({localDelivery:{enabled:true,estimatedDays}}),error=>error.code==='VALIDATION');
  assert.throws(()=>validate({freeShippingEnabled:true,freeShippingThresholdCents:0}),error=>error.code==='VALIDATION');
  const saved=validate({enabled:true,rateMode:'regional',regionRates:{SE:{enabled:true,priceCents:1800,estimatedDays:5}},pickup:{enabled:true},localDelivery:{enabled:true,estimatedDays:1}});
  assert.equal(saved.regionRates.SE.priceCents,1800);assert.equal(saved.regionRates.N.enabled,false);assert.equal(saved.freeShippingThresholdCents,15000);assert.equal(hasConfiguredShipping(saved,{production:true}),true);
  const patched=validateShippingSettings({regionRates:{SE:{priceCents:2200}}},saved,{fail,store});assert.equal(patched.regionRates.SE.enabled,true);assert.equal(patched.regionRates.SE.estimatedDays,5);assert.equal(patched.regionRates.SE.priceCents,2200);
});

test('API comercial persiste política admin e usa desconto e CEP autoritativos na cotação',async t=>{
  const {createServer}=require('../serve.cjs'),{hashPassword}=require('../server/auth.cjs');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'bkm-regional-'));
  const server=createServer({root:directory,dbPath:path.join(directory,'isolated.sqlite'),databaseUrl:'',env:{BKM_ENVIRONMENT:'production',PAYMENT_PROVIDER:'disabled',EMAIL_PROVIDER:'disabled'},shippingFetch:transport});
  await server.api.ready;server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await server.api.close();fs.rmSync(directory,{recursive:true,force:true});});
  const db=server.api.asyncStore,stamp=new Date().toISOString(),adminId=crypto.randomUUID();
  await db.prepare("INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,'ADMIN',?)").run(adminId,'frete@example.test','Admin teste',await hashPassword('test-admin-long-password'),stamp);
  const base='http://127.0.0.1:'+server.address().port;let cookie='',csrf='';
  async function call(route,{method='GET',body}={}){const r=await fetch(base+route,{method,headers:{cookie,'x-csrf-token':csrf,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];const data=await r.json();if(data.csrfToken)csrf=data.csrfToken;return {status:r.status,data};}
  await call('/api/session');assert.equal((await call('/api/auth/login',{method:'POST',body:{email:'frete@example.test',password:'test-admin-long-password'}})).status,200);
  const s=policySettings();assert.equal((await call('/api/admin/settings',{method:'PUT',body:{shipping:s,address:'',city:'Uberlândia',state:'MG',whatsapp:'5534999999999'}})).status,200);
  const publicSettings=(await call('/api/config')).data;assert.equal(publicSettings.city,'Uberlândia');assert.equal(publicSettings.state,'MG');assert.equal(publicSettings.address,'');
  assert.equal((await call('/api/admin/settings',{method:'PUT',body:{whatsapp:''}})).status,422,'contato não pode ser removido enquanto retirada/local estão ativos');
  assert.equal((await call('/api/admin/settings',{method:'PUT',body:{state:'XX'}})).status,422);
  assert.equal((await call('/api/admin/integrations')).data.shipping.configured,true);
  const saved=await call('/api/admin/products',{method:'POST',body:{kind:'SEALED',name:'Produto controlado',slug:'regional-fixture',sku:'REGIONAL-1',description:'Somente teste isolado',setId:'test',setName:'Teste',images:[{url:'/assets/pack.webp',kind:'reference'}],published:true,variants:[{language:'pt',condition:'SEALED',finish:'NORMAL',priceCents:16000,stock:3}]}});
  assert.equal(saved.status,201,JSON.stringify(saved.data));
  const variantId=saved.data.variants[0].id;await db.prepare('INSERT INTO coupons VALUES(?,?,?,?,?,?,?,?,0,?,?)').run(crypto.randomUUID(),'REDUZ','FIXED',2000,0,null,null,null,1,stamp);
  const q=await call('/api/checkout/quote',{method:'POST',body:{items:[{variantId,quantity:1}],coupon:'REDUZ',cep:'01001000',address:{city:'São Paulo',state:'SP'}}});
  assert.equal(q.status,200,JSON.stringify(q.data));assert.equal(q.data.discountCents,2000);assert.equal(q.data.shippingCents,1300);assert.equal(q.data.shipping.remainingForFreeShippingCents,1000);assert.equal(q.data.totalCents,15300);
  const spoof=await call('/api/checkout/quote',{method:'POST',body:{items:[{variantId,quantity:1}],cep:'01001000',deliveryMode:'local',address:{city:'Uberlândia',state:'MG'}}});assert.equal(spoof.status,422);assert.equal(spoof.data.error.code,'ADDRESS_CEP_MISMATCH');
  const pickup=await call('/api/checkout/quote',{method:'POST',body:{items:[{variantId,quantity:1}],deliveryMode:'pickup'}});assert.equal(pickup.status,200);assert.equal(pickup.data.shippingCents,0);assert.equal(pickup.data.shipping.deliveryMode,'pickup');
  assert.equal((await call('/api/config')).data.shippingConfigured,true);
});
