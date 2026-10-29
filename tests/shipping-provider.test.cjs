const test=require('node:test'),assert=require('node:assert/strict');
const {createShippingProvider,shippingReadiness,brlToCents}=require('../server/shipping-provider.cjs');
const env={SHIPPING_PROVIDER:'melhorenvio',MELHOR_ENVIO_ENABLED:'true',MELHOR_ENVIO_ENVIRONMENT:'sandbox',MELHOR_ENVIO_TOKEN:'private-test-token-not-for-production',MELHOR_ENVIO_USER_AGENT:'BKM TCG (tech@example.com)',MELHOR_ENVIO_ORIGIN_ZIP:'01001-000'};
const item={id:'variant-a',quantity:2,widthCm:10,heightCm:3,lengthCm:16,weightGrams:120,priceCents:12345};
const valid={id:1,name:'PAC',price:'88.88',custom_price:'12.34',currency:'R$',delivery_time:12,custom_delivery_time:7,custom_delivery_range:{min:6,max:7},company:{name:'Correios'}};
const uuid='ca4a67e4-4432-4cf5-8f17-9bdc2fd7aaa1';
const json=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
const provider=(data,options={})=>createShippingProvider({env,fetchImpl:async()=>json(data),...options});
test('shipping readiness requires explicit matching environments and never exposes credentials',async()=>{
  assert.equal(shippingReadiness({}).enabled,false);assert.equal(shippingReadiness(env).enabled,true);assert.equal(shippingReadiness({...env,MELHOR_ENVIO_ENVIRONMENT:'production'}).enabled,false);assert.equal(shippingReadiness({...env,MELHOR_ENVIO_USER_AGENT:'BKM\r\nInjected: value'}).enabled,false);
  const readiness=shippingReadiness(env);assert.equal(readiness.purchasesEnabled,false);assert(!JSON.stringify(readiness).includes(env.MELHOR_ENVIO_TOKEN));let called=false;
  await assert.rejects(createShippingProvider({env:{},fetchImpl:async()=>{called=true;}}).quote({zip:'20040002',items:[item]}),{code:'SHIPPING_NOT_CONFIGURED'});assert.equal(called,false);
});
test('quote uses fixed sandbox endpoint, cm/kg/BRL units and custom values',async()=>{
  let call;const p=createShippingProvider({env:{...env,MELHOR_ENVIO_API_URL:'http://127.0.0.1/private'},now:()=>Date.parse('2026-10-19T12:00:00Z'),fetchImpl:async(url,options)=>{call={url,options};return json([valid]);}});
  const result=await p.quote({zip:'20040-002',items:[item],services:[1,1]});assert.equal(call.url,'https://sandbox.melhorenvio.com.br/api/v2/me/shipment/calculate');assert.equal(call.options.redirect,'manual');assert.equal(call.options.headers.Authorization,`Bearer ${env.MELHOR_ENVIO_TOKEN}`);
  const payload=JSON.parse(call.options.body);assert.equal(payload.from.postal_code,'01001000');assert.equal(payload.to.postal_code,'20040002');assert.equal(payload.products[0].weight,.12);assert.equal(payload.products[0].insurance_value,123.45);assert.equal(payload.services,'1');assert.deepEqual(payload.options,{receipt:false,own_hand:false});assert.equal(result.quotes[0].amountCents,1234);assert.equal(result.quotes[0].estimatedDays,7);assert.equal(result.quotes[0].sandbox,true);assert.equal(result.quotes[0].contracted,false);assert(!JSON.stringify(result).includes(env.MELHOR_ENVIO_TOKEN));assert.deepEqual(Object.keys(p).sort(),['quote','readiness','tracking']);
});
test('money conversion rejects imprecise or non-BRL-looking numeric input',()=>{
  assert.equal(brlToCents('0.01'),1);assert.equal(brlToCents('10.1'),1010);assert.equal(brlToCents(2.3),230);
  for(const value of ['1,23','1e2','-1','1.005',NaN,Infinity,'001.00',{},1000001])assert.throws(()=>brlToCents(value),{code:'SHIPPING_INVALID_RESPONSE'});
});
test('packed volumes quote real package totals, not per-card quantities, without purchasing labels',async()=>{
  let payload;const p=createShippingProvider({env,fetchImpl:async(url,options)=>{payload=JSON.parse(options.body);return json([valid]);}});
  const result=await p.quote({zip:'20040002',volumes:[{weightGrams:250,widthCm:12,heightCm:3,lengthCm:17,insuranceValueCents:4500}]});
  assert.deepEqual(payload.volumes,[{weight:.25,width:12,height:3,length:17,insurance:45}]);assert.equal(payload.products,undefined);assert.equal(result.purchasesEnabled,false);assert.equal(p.readiness().productionSupported,true);assert.equal(p.readiness().checkoutIntegrated,true);
});

test('production quotations use the fixed production origin only with production store configuration',async()=>{
  const production={...env,BKM_ENVIRONMENT:'production',MELHOR_ENVIO_ENVIRONMENT:'production'};let url;
  const p=createShippingProvider({env:production,fetchImpl:async value=>{url=value;return json([valid]);}});
  const result=await p.quote({zip:'20040002',items:[item]});assert.equal(url,'https://melhorenvio.com.br/api/v2/me/shipment/calculate');assert.equal(result.environment,'production');assert.equal(result.quotes[0].sandbox,false);assert.equal(result.purchasesEnabled,false);
  for(const mode of[{BKM_ENVIRONMENT:'demo'},{HOSTING_DEMO_ONLY:'true'}])assert.equal(shippingReadiness({...production,...mode}).enabled,false);
});
test('packed volume validation rejects mixing products, missing values and unavailable sandbox responses',async()=>{
  let calls=0;const p=createShippingProvider({env,fetchImpl:async()=>{calls++;return json([]);}}),volume={weightGrams:250,widthCm:12,heightCm:3,lengthCm:17,insuranceValueCents:4500};
  for(const request of[{items:[item],volumes:[volume]},{volumes:[]},{volumes:[{...volume,weightGrams:null}]},{volumes:[{...volume,quantity:1}]},{volumes:[{...volume,insuranceValueCents:-1}]}])await assert.rejects(p.quote({zip:'20040002',...request}),{code:'SHIPPING_INVALID_INPUT'});
  assert.equal(calls,0);const result=await p.quote({zip:'20040002',volumes:[volume]});assert.deepEqual(result.quotes,[]);assert.equal(result.environment,'sandbox');assert.equal(result.purchasesEnabled,false);
});
test('invalid CEP, dimensions, quantity, weight, prices or service cannot trigger network',async()=>{
  let calls=0;const p=createShippingProvider({env,fetchImpl:async()=>{calls++;return json([valid]);}});
  for(const request of [{zip:'http://127.0.0.1',items:[item]},{zip:'00000000',items:[item]},{zip:'20040002',items:[{...item,heightCm:0}]},{zip:'20040002',items:[{...item,weightGrams:0}]},{zip:'20040002',items:[{...item,quantity:1.5}]},{zip:'20040002',items:[{...item,priceCents:1.1}]},{zip:'20040002',items:[item,item]},{zip:'20040002',items:[item],services:['1']}])await assert.rejects(p.quote(request),{code:'SHIPPING_INVALID_INPUT'});assert.equal(calls,0);
});
test('provider unavailable service stays unavailable without invented price',async()=>{const result=await provider([{id:1,error:'Provider-specific private body'}]).quote({zip:'20040002',items:[item]});assert.equal(result.quotes.length,0);assert.equal(result.unavailable.length,1);assert(!JSON.stringify(result).includes('Provider-specific'));});

test('explicit incomplete package quotations are unavailable; legitimate consolidation does not require equal package counts',async()=>{
  const volumes=[{weightGrams:200,widthCm:12,heightCm:3,lengthCm:17,insuranceValueCents:1000},{weightGrams:200,widthCm:12,heightCm:3,lengthCm:17,insuranceValueCents:1000}];
  const result=await provider([{...valid,packages:[{price:'12.34',weight:.4}]},{...valid,id:2,packages:[{error:'Private package error'}]},{...valid,id:3,packages:[]}]).quote({zip:'20040002',volumes});assert.equal(result.quotes.length,1);assert.equal(result.quotes[0].packageCount,1);assert.equal(result.unavailable.length,2);assert(!JSON.stringify(result).includes('Private'));
  for(const packages of[{},[null],[{price:'1.005'}]])await assert.rejects(provider([{...valid,packages}]).quote({zip:'20040002',volumes}),{code:'SHIPPING_INVALID_RESPONSE'});
});
test('foreign currency, missing custom quote, wrong service and malformed delivery fail closed',async()=>{
  for(const row of [{...valid,currency:'USD'},{...valid,custom_price:undefined},{...valid,custom_delivery_time:undefined},{...valid,custom_delivery_range:{min:8,max:3}},{...valid,id:2}])await assert.rejects(provider([row]).quote({zip:'20040002',items:[item],services:[1]}),{code:'SHIPPING_INVALID_RESPONSE'});
});
test('HTTP errors and redirects never echo provider body or follow Location',async()=>{
  for(const [status,code]of [[401,'SHIPPING_AUTH_FAILED'],[403,'SHIPPING_AUTH_FAILED'],[429,'SHIPPING_RATE_LIMIT'],[422,'SHIPPING_PROVIDER_REJECTED'],[503,'SHIPPING_PROVIDER_UNAVAILABLE'],[302,'SHIPPING_REDIRECT_REJECTED']]){
    const p=createShippingProvider({env,fetchImpl:async()=>new Response(env.MELHOR_ENVIO_TOKEN,{status,headers:{Location:'https://untrusted.example'}})});await assert.rejects(p.quote({zip:'20040002',items:[item]}),error=>error.code===code&&!error.message.includes(env.MELHOR_ENVIO_TOKEN));
  }
});
test('invalid JSON, unexpected content type and oversized payload are rejected',async()=>{
  for(const response of [new Response('{',{headers:{'Content-Type':'application/json'}}),new Response('<html>',{headers:{'Content-Type':'text/html'}}),new Response('[]',{headers:{'Content-Type':'application/json','Content-Length':'2000000'}}),new Response(JSON.stringify('x'.repeat(1024*1024+1)),{headers:{'Content-Type':'application/json'}})])await assert.rejects(createShippingProvider({env,fetchImpl:async()=>response}).quote({zip:'20040002',items:[item]}),{code:'SHIPPING_INVALID_RESPONSE'});
});
test('timeout is bounded even when fetch ignores abort',async()=>{
  const start=Date.now();await assert.rejects(createShippingProvider({env,timeoutMs:100,fetchImpl:()=>new Promise(()=>{})}).quote({zip:'20040002',items:[item]}),{code:'SHIPPING_TIMEOUT'});assert(Date.now()-start<2000);
});
test('tracking only queries existing UUID labels and preserves provider status',async()=>{
  let request;const p=createShippingProvider({env,fetchImpl:async(url,options)=>{request={url,body:JSON.parse(options.body)};return json({[uuid]:{id:uuid,status:'released',tracking:'AB123456789BR',protocol:'ORD-123',created_at:'2026-10-19T12:00:00Z'}});}});
  const result=await p.tracking({orderIds:[uuid,uuid]});assert.equal(request.url,'https://sandbox.melhorenvio.com.br/api/v2/me/shipment/tracking');assert.deepEqual(request.body,{orders:[uuid]});assert.equal(result.items[0].providerStatus,'released');assert.equal(result.items[0].trackingCode,'AB123456789BR');assert.equal(result.items[0].sandbox,true);assert.equal(result.items[0].shippingStatus,undefined);
});
test('tracking rejects other account IDs, malformed records and URL input',async()=>{
  const other='ca4a67e4-4432-4cf5-8f17-9bdc2fd7aaa2';await assert.rejects(provider({[other]:{status:'posted'}}).tracking({orderIds:[uuid]}),{code:'SHIPPING_INVALID_RESPONSE'});await assert.rejects(provider({[uuid]:{status:'posted',tracking:'https://bad.example'}}).tracking({orderIds:[uuid]}),{code:'SHIPPING_INVALID_RESPONSE'});await assert.rejects(provider({}).tracking({orderIds:['https://bad.example']}),{code:'SHIPPING_INVALID_INPUT'});
  assert.deepEqual((await provider({}).tracking({orderIds:[uuid]})).items[0],{id:uuid,found:false,providerStatus:null,trackingCode:null,sandbox:true});
});
