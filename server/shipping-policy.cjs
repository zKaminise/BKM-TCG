// Regions follow IBGE's five macroregions. A customer's free-text city/UF
// never determines a shipping price: commercial destinations come from ViaCEP.
const REGION_STATES = Object.freeze({N:['AC','AP','AM','PA','RO','RR','TO'],NE:['AL','BA','CE','MA','PB','PE','PI','RN','SE'],CO:['DF','GO','MT','MS'],SE:['ES','MG','RJ','SP'],S:['PR','RS','SC']});
const REGION_NAMES = Object.freeze({N:'Norte',NE:'Nordeste',CO:'Centro-Oeste',SE:'Sudeste',S:'Sul'});
const UBERLANDIA_IBGE = '3170206';
const normalized = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase().replace(/\s+/g,' ');
function shippingSettings(raw = {}) {
  const regionRates = Object.fromEntries(Object.keys(REGION_STATES).map(id=>[id,{enabled:false,priceCents:null,estimatedDays:null,...raw.regionRates?.[id]}]));
  return {enabled:false,rateMode:'flat',flatRateCents:0,estimatedDays:0,freeShippingEnabled:false,freeShippingThresholdCents:15000,regions:[],...raw,
    freeShippingThresholdCents:raw.freeShippingThresholdCents ?? 15000,regionRates,pickup:{enabled:false,...raw.pickup},localDelivery:{enabled:false,estimatedDays:null,...raw.localDelivery}};
}
function validateShippingSettings(input,current,{fail,store}) {
  if(!input || typeof input!=='object' || Array.isArray(input)) fail('VALIDATION','Configuração de frete inválida.');
  const allowed=['enabled','rateMode','flatRateCents','estimatedDays','freeShippingEnabled','freeShippingThresholdCents','regions','regionRates','pickup','localDelivery'];
  if(Object.keys(input).some(key=>!allowed.includes(key))) fail('VALIDATION','Campo de frete desconhecido.');
  for(const [key,fields] of [['pickup',['enabled']],['localDelivery',['enabled','estimatedDays']]])if(key in input&&(!input[key]||typeof input[key]!=='object'||Array.isArray(input[key])||Object.keys(input[key]).some(field=>!fields.includes(field))))fail('VALIDATION','Modalidade de frete inválida.');
  if('regionRates' in input&&(!input.regionRates||typeof input.regionRates!=='object'||Array.isArray(input.regionRates)||Object.keys(input.regionRates).some(id=>!Object.hasOwn(REGION_STATES,id))))fail('VALIDATION','Região brasileira inválida.');
  for(const rate of Object.values(input.regionRates||{}))if(!rate||typeof rate!=='object'||Array.isArray(rate)||Object.keys(rate).some(key=>!['enabled','priceCents','estimatedDays'].includes(key)))fail('VALIDATION','Tarifa regional inválida.');
  const regionRates=Object.fromEntries(Object.keys(REGION_STATES).map(id=>[id,{...current.regionRates?.[id],...input.regionRates?.[id]}]));
  const s=shippingSettings({...current,...input,regionRates,pickup:{...current.pickup,...input.pickup},localDelivery:{...current.localDelivery,...input.localDelivery}});
  const boolean=(value,key)=>{if(typeof value!=='boolean')fail('VALIDATION',`Revise ${key}.`);return value;};
  const integer=(value,key,{nullable=false,min=0,max=100000000}={})=>{if(nullable&&value==null)return null;if(!Number.isSafeInteger(value)||value<min||value>max)fail('VALIDATION',`Revise ${key}.`);return value;};
  s.enabled=boolean(s.enabled,'frete habilitado');
  if(!['flat','regional'].includes(s.rateMode))fail('VALIDATION','Escolha tarifa única ou por região.');
  s.flatRateCents=integer(s.flatRateCents,'tarifa única');s.estimatedDays=integer(s.estimatedDays,'prazo',{max:365});
  s.freeShippingEnabled=boolean(s.freeShippingEnabled,'frete grátis');
  s.freeShippingThresholdCents=integer(s.freeShippingThresholdCents,'mínimo para frete grátis',{nullable:!s.freeShippingEnabled,min:1});
  if(!Array.isArray(s.regions)||s.regions.length>100)fail('VALIDATION','Informe até 100 faixas de cobertura.');
  s.regions=s.regions.map(range=>{const start=String(range?.start||'').replace(/\D/g,''),end=String(range?.end||'').replace(/\D/g,'');if(!/^\d{8}$/.test(start)||!/^\d{8}$/.test(end)||start>end)fail('VALIDATION','Faixa de CEP inválida.');return {start,end};});
  s.regionRates=Object.fromEntries(Object.keys(REGION_STATES).map(id=>{
    const rate=s.regionRates[id];
    if(!rate||typeof rate!=='object'||Array.isArray(rate)||Object.keys(rate).some(key=>!['enabled','priceCents','estimatedDays'].includes(key)))fail('VALIDATION','Tarifa regional inválida.');
    return [id,{enabled:boolean(rate.enabled,'região '+id),priceCents:integer(rate.priceCents,'preço '+id,{nullable:!rate.enabled}),estimatedDays:integer(rate.estimatedDays,'prazo '+id,{nullable:!rate.enabled,max:365})}];
  }));
  s.pickup={enabled:boolean(s.pickup.enabled,'retirada na loja')};
  s.localDelivery={enabled:boolean(s.localDelivery.enabled,'entrega em Uberlândia'),estimatedDays:integer(s.localDelivery.estimatedDays,'prazo local',{nullable:true,max:365})};
  const hasLocality=!!String(store.city||'').trim()&&Object.values(REGION_STATES).some(states=>states.includes(store.state));
  if((s.pickup.enabled||s.localDelivery.enabled)&&(!(hasLocality||String(store.address||'').trim())||!/^\d{10,13}$/.test(String(store.whatsapp||'').replace(/\D/g,''))))fail('VALIDATION','Cadastre a cidade/UF da loja e o WhatsApp antes de habilitar retirada ou entrega local. O endereço exato da retirada pode ser combinado após o pagamento.');
  if(s.localDelivery.enabled&&(!hasLocality||normalized(store.city)!=='uberlandia'||store.state!=='MG'))fail('VALIDATION','A entrega local gratuita exige que a localidade da loja esteja configurada como Uberlândia/MG.');
  return s;
}
function hasConfiguredShipping(raw,{production=false}={}) {
  const s=shippingSettings(raw);
  return !!(s.pickup.enabled||s.localDelivery.enabled||(s.enabled&&(s.rateMode==='regional'?Object.values(s.regionRates).some(rate=>rate.enabled&&Number.isSafeInteger(rate.priceCents)&&Number.isSafeInteger(rate.estimatedDays)):!production)));
}
function createShippingPolicy({ApiError,fetchImpl=globalThis.fetch,now=()=>Date.now(),production=false}={}) {
  const cache=new Map(),pending=new Map();
  const fail=(status,code,message)=>{throw new ApiError(status,code,message);};
  async function destination(cep) {
    if(cache.has(cep)&&cache.get(cep).until>now())return cache.get(cep).value;
    if(pending.has(cep))return pending.get(cep);
    const request=Promise.resolve().then(async()=>{
      try {
        const response=await fetchImpl(`https://viacep.com.br/ws/${cep}/json/`,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(4500),redirect:'error'});
        if(!response.ok)fail(503,'SHIPPING_LOOKUP_UNAVAILABLE','Não foi possível verificar o CEP agora. Tente novamente.');
        const data=await response.json();
        if(data?.erro)fail(422,'INVALID_CEP','CEP não encontrado. Confira o endereço.');
        const state=String(data?.uf||''),regionId=Object.keys(REGION_STATES).find(id=>REGION_STATES[id].includes(state));
        if(!data||String(data.cep||'').replace(/\D/g,'')!==cep||!regionId||typeof data.localidade!=='string'||!data.localidade.trim()||data.localidade.length>120||!/^\d{7}$/.test(String(data.ibge||'')))fail(503,'SHIPPING_LOOKUP_UNAVAILABLE','O serviço de CEP retornou dados inválidos. Tente novamente.');
        const value={zip:cep,city:data.localidade.trim(),state,ibge:String(data.ibge),regionId,street:typeof data.logradouro==='string'?data.logradouro.slice(0,200):'',district:typeof data.bairro==='string'?data.bairro.slice(0,200):''};
        if(cache.size>=1000)cache.delete(cache.keys().next().value);
        cache.set(cep,{value,until:now()+3600000});return value;
      }catch(error){if(error instanceof ApiError)throw error;fail(503,'SHIPPING_LOOKUP_UNAVAILABLE','Não foi possível verificar o CEP agora. Tente novamente.');}
      finally{pending.delete(cep);}
    });pending.set(cep,request);return request;
  }
  async function quote({settings:raw,netCents,cep:rawCep,deliveryMode='delivery',address={}}) {
    const s=shippingSettings(raw),cep=String(rawCep||'').replace(/\D/g,'');
    if(!address||typeof address!=='object'||Array.isArray(address))fail(422,'ADDRESS','Endereço inválido.');
    if(!['delivery','pickup','local'].includes(deliveryMode))fail(422,'SHIPPING_METHOD','Escolha uma modalidade de entrega válida.');
    if(cep&&!/^\d{8}$/.test(cep))fail(422,'INVALID_CEP','Informe um CEP com oito números.');
    const base={available:false,reason:null,cep,free:false,estimatedDays:null,deliveryMode,destination:null,regionId:null,freeShippingThresholdCents:s.freeShippingEnabled?s.freeShippingThresholdCents:null,remainingForFreeShippingCents:s.enabled&&s.freeShippingEnabled?Math.max(0,s.freeShippingThresholdCents-netCents):null};
    const unavailable=reason=>({...base,reason,shippingCents:null});
    if(deliveryMode==='pickup')return s.pickup.enabled?{...base,available:true,shippingCents:0,free:true,estimatedDays:0}:unavailable('Retirada na loja indisponível.');
    if(deliveryMode==='local'&&!s.localDelivery.enabled)return unavailable('Entrega local indisponível.');
    if(!s.enabled&&!s.localDelivery.enabled)return unavailable('Frete ainda não configurado pela loja.');
    if(!cep)return unavailable('Informe o CEP para calcular a entrega.');
    const requiresVerified=production||s.rateMode==='regional'||s.localDelivery.enabled;
    const found=requiresVerified?await destination(cep):null;
    if(found){
      if(address.state&&String(address.state).trim().toUpperCase()!==found.state||address.city&&normalized(address.city)!==normalized(found.city))fail(422,'ADDRESS_CEP_MISMATCH','A cidade e a UF precisam corresponder ao CEP informado.');
      base.destination=found;base.regionId=found.regionId;
    }
    const local=found?.state==='MG'&&found.ibge===UBERLANDIA_IBGE&&normalized(found.city)==='uberlandia';
    if(deliveryMode==='local'||s.localDelivery.enabled&&local){
      if(!local)return unavailable('A entrega local gratuita é exclusiva para endereços verificados de Uberlândia/MG.');
      return {...base,deliveryMode:'local',available:true,shippingCents:0,free:true,estimatedDays:s.localDelivery.estimatedDays};
    }
    if(!s.enabled)return unavailable('Entrega para outras cidades indisponível.');
    if(s.regions.length&&!s.regions.some(range=>cep>=range.start&&cep<=range.end))return unavailable('Entrega indisponível para este CEP.');
    if(production&&s.rateMode!=='regional')return unavailable('As tarifas de entrega por região ainda não foram configuradas pela loja.');
    const rate=s.rateMode==='regional'?s.regionRates[found.regionId]:{enabled:true,priceCents:s.flatRateCents,estimatedDays:s.estimatedDays};
    if(!rate?.enabled||!Number.isSafeInteger(rate.priceCents)||!Number.isSafeInteger(rate.estimatedDays))return unavailable('Entrega indisponível para esta região.');
    const free=!!(s.freeShippingEnabled&&netCents>=s.freeShippingThresholdCents);
    return {...base,available:true,shippingCents:free?0:rate.priceCents,free,estimatedDays:rate.estimatedDays};
  }
  return {quote,destination};
}
module.exports={REGION_STATES,REGION_NAMES,UBERLANDIA_IBGE,shippingSettings,validateShippingSettings,hasConfiguredShipping,createShippingPolicy};
