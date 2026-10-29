const {validatePackingProfiles,packingProfilesReady,packingPlan}=require('./shipping-packing.cjs');
const {createShippingProvider,shippingReadiness}=require('./shipping-provider.cjs');
// Regions follow IBGE's five macroregions. A customer's free-text city/UF
// never determines a shipping price: commercial destinations come from ViaCEP.
const REGION_STATES = Object.freeze({N:['AC','AP','AM','PA','RO','RR','TO'],NE:['AL','BA','CE','MA','PB','PE','PI','RN','SE'],CO:['DF','GO','MT','MS'],SE:['ES','MG','RJ','SP'],S:['PR','RS','SC']});
const REGION_NAMES = Object.freeze({N:'Norte',NE:'Nordeste',CO:'Centro-Oeste',SE:'Sudeste',S:'Sul'});
const UBERLANDIA_IBGE = '3170206';
const normalized = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase().replace(/\s+/g,' ');
const ORIGIN_FIELDS=['zip','street','number','complement','district','city','state'];
const PACKAGE_FIELDS=['id','name','weightGrams','widthCm','heightCm','lengthCm','active'];
const STATES=Object.values(REGION_STATES).flat();
const RATE_FIELDS=['enabled','priceCents','estimatedDays','carrier','serviceName','validated','validatedAt','cepRanges'];
function shippingSettings(raw = {}) {
  const regionRates = Object.fromEntries(Object.keys(REGION_STATES).map(id=>[id,{enabled:false,priceCents:null,estimatedDays:null,carrier:'',serviceName:'',validated:false,validatedAt:null,cepRanges:[],...raw.regionRates?.[id]}]));
  return {enabled:false,rateMode:'flat',flatRateCents:0,estimatedDays:0,freeShippingEnabled:false,freeShippingThresholdCents:15000,regions:[],...raw,
    freeShippingThresholdCents:raw.freeShippingThresholdCents ?? 15000,regionRates,pickup:{enabled:false,...raw.pickup},localDelivery:{enabled:false,estimatedDays:null,...raw.localDelivery},
    origin:Object.fromEntries(ORIGIN_FIELDS.map(key=>[key,raw.origin?.[key]??''])),packages:Array.isArray(raw.packages)?raw.packages:[],defaultPackageId:raw.defaultPackageId??'',packingProfiles:Array.isArray(raw.packingProfiles)?raw.packingProfiles:[],packingProfilesValidated:raw.packingProfilesValidated===true,packingProfilesValidatedAt:raw.packingProfilesValidatedAt??null,stateRates:raw.stateRates&&typeof raw.stateRates==='object'&&!Array.isArray(raw.stateRates)?raw.stateRates:{}};
}
function operationalShippingReadiness(raw={}) {
  const s=shippingSettings(raw),missing=[];
  for(const key of ['zip','street','number','district','city','state'])if(!s.origin[key])missing.push('Origem: '+({zip:'CEP',street:'rua',number:'número',district:'bairro',city:'cidade',state:'UF'})[key]);
  if(!/^\d{8}$/.test(s.origin.zip)||s.origin.zip==='00000000')missing.push('CEP de origem válido');
  if(!Object.values(REGION_STATES).flat().includes(s.origin.state))missing.push('UF de origem válida');
  const validPackage=s.packages.find(row=>row&&row.id===s.defaultPackageId&&row.active&&Number.isSafeInteger(row.weightGrams)&&row.weightGrams>0&&row.weightGrams<=30000&&['widthCm','heightCm','lengthCm'].every(key=>typeof row[key]==='number'&&Number.isFinite(row[key])&&row[key]>=.1&&row[key]<=300));
  if(s.rateMode==='regional'&&!validPackage)missing.push('Embalagem padrão ativa com peso e medidas');
  if(['profile_table','melhorenvio'].includes(s.rateMode)&&!packingProfilesReady(s))missing.push('Perfis de embalagem com peso, medidas, capacidade e confirmação operacional');
  const regions=Object.fromEntries(Object.keys(REGION_STATES).map(id=>{
    const rate=s.regionRates[id],absent=[];
    if(!rate.carrier)absent.push('Transportadora');if(!rate.serviceName)absent.push('Serviço');
    if(!Number.isSafeInteger(rate.priceCents)||rate.priceCents<0)absent.push('Preço');
    if(!Number.isSafeInteger(rate.estimatedDays)||rate.estimatedDays<1||rate.estimatedDays>365)absent.push('Prazo');
    if(!rate.validated||!/^\d{4}-\d{2}-\d{2}$/.test(rate.validatedAt||''))absent.push('Validação operacional e data');
    return [id,{enabled:rate.enabled,ready:absent.length===0,missing:absent}];
  }));
  const readyRegions=Object.keys(regions).filter(id=>regions[id].enabled&&regions[id].ready);
  for(const [id,region]of Object.entries(regions))if(s.rateMode==='regional'&&region.enabled&&!region.ready)missing.push(REGION_NAMES[id]+': '+region.missing.join(', '));
  const validStateRates=Object.values(s.stateRates).some(rate=>rate.enabled&&rate.validated&&Number.isSafeInteger(rate.priceCents)&&Number.isSafeInteger(rate.estimatedDays)&&rate.estimatedDays>0&&rate.carrier&&rate.serviceName&&rate.validatedAt);
  if((s.rateMode==='regional'&&!readyRegions.length)||(s.rateMode==='profile_table'&&!readyRegions.length&&!validStateRates))missing.push('Ao menos um estado ou região com tarifa e serviço validados');
  return {nationalEnabled:s.enabled,nationalReady:['regional','profile_table','melhorenvio'].includes(s.rateMode)&&missing.length===0,missing:[...new Set(missing)],regions,mode:s.rateMode==='melhorenvio'?'carrier_quotes':s.rateMode==='profile_table'?'profile_and_state_rates':'manual_validated_rates',carrierQuotesAutomatic:s.rateMode==='melhorenvio',labelPurchasesEnabled:false};
}
// Posting addresses and packing profiles are administration data, even when
// the public customer API returns the store settings.
function publicShippingSettings(raw={}) {
  const s=shippingSettings(raw);
  return {enabled:s.enabled,rateMode:s.rateMode,flatRateCents:s.flatRateCents,estimatedDays:s.estimatedDays,freeShippingEnabled:s.freeShippingEnabled,freeShippingThresholdCents:s.freeShippingThresholdCents,regions:s.regions,pickup:s.pickup,localDelivery:s.localDelivery,
    regionRates:Object.fromEntries(Object.entries(s.regionRates).map(([id,rate])=>[id,{enabled:rate.enabled,priceCents:rate.priceCents,estimatedDays:rate.estimatedDays,carrier:rate.carrier,serviceName:rate.serviceName}]))};
}
function validateShippingSettings(input,current,{fail,store,env={}}) {
  if(!input || typeof input!=='object' || Array.isArray(input)) fail('VALIDATION','Configuração de frete inválida.');
  const allowed=['enabled','rateMode','flatRateCents','estimatedDays','freeShippingEnabled','freeShippingThresholdCents','regions','regionRates','pickup','localDelivery','origin','packages','defaultPackageId','packingProfiles','packingProfilesValidated','packingProfilesValidatedAt','stateRates'];
  if(Object.keys(input).some(key=>!allowed.includes(key))) fail('VALIDATION','Campo de frete desconhecido.');
  for(const [key,fields] of [['pickup',['enabled']],['localDelivery',['enabled','estimatedDays']]])if(key in input&&(!input[key]||typeof input[key]!=='object'||Array.isArray(input[key])||Object.keys(input[key]).some(field=>!fields.includes(field))))fail('VALIDATION','Modalidade de frete inválida.');
  if('regionRates' in input&&(!input.regionRates||typeof input.regionRates!=='object'||Array.isArray(input.regionRates)||Object.keys(input.regionRates).some(id=>!Object.hasOwn(REGION_STATES,id))))fail('VALIDATION','Região brasileira inválida.');
  for(const rate of Object.values(input.regionRates||{}))if(!rate||typeof rate!=='object'||Array.isArray(rate)||Object.keys(rate).some(key=>!RATE_FIELDS.includes(key)))fail('VALIDATION','Tarifa regional inválida.');
  if('origin' in input&&(!input.origin||typeof input.origin!=='object'||Array.isArray(input.origin)||Object.keys(input.origin).some(key=>!ORIGIN_FIELDS.includes(key))))fail('VALIDATION','Origem de postagem inválida.');
  if('packingProfiles' in input&&!Array.isArray(input.packingProfiles))fail('VALIDATION','Perfis de embalagem inválidos.');
  if('stateRates' in input&&(!input.stateRates||typeof input.stateRates!=='object'||Array.isArray(input.stateRates)))fail('VALIDATION','Tabela por estado inválida.');
  const regionRates=Object.fromEntries(Object.keys(REGION_STATES).map(id=>[id,{...current.regionRates?.[id],...input.regionRates?.[id]}]));
  const s=shippingSettings({...current,...input,regionRates,origin:{...current.origin,...input.origin},pickup:{...current.pickup,...input.pickup},localDelivery:{...current.localDelivery,...input.localDelivery}});
  const boolean=(value,key)=>{if(typeof value!=='boolean')fail('VALIDATION',`Revise ${key}.`);return value;};
  const integer=(value,key,{nullable=false,min=0,max=100000000}={})=>{if(nullable&&value==null)return null;if(!Number.isSafeInteger(value)||value<min||value>max)fail('VALIDATION',`Revise ${key}.`);return value;};
  const text=(value,label,max=150)=>{if(typeof value!=='string'||value.length>max||/[\u0000-\u001f\u007f]/.test(value))fail('VALIDATION',`Revise ${label}.`);return value.trim();};
  function cep(value,label){if(typeof value!=='string'||!/^\d{5}-?\d{3}$/.test(value.trim())||value.replace('-','')==='00000000')fail('VALIDATION',`Revise ${label}. Use oito números.`);return value.trim().replace('-','');}
  function ranges(values,label){if(!Array.isArray(values)||values.length>100)fail('VALIDATION',`Informe até 100 faixas de CEP em ${label}.`);const result=values.map(range=>{if(!range||typeof range!=='object'||Array.isArray(range)||Object.keys(range).some(key=>!['start','end'].includes(key)))fail('VALIDATION','Faixa de CEP inválida.');const start=cep(range.start,'início da faixa'),end=cep(range.end,'fim da faixa');if(start>end)fail('VALIDATION','O início da faixa de CEP deve vir antes do fim.');return {start,end};}).sort((a,b)=>a.start.localeCompare(b.start));for(let i=1;i<result.length;i++)if(result[i].start<=result[i-1].end)fail('VALIDATION','Faixas de CEP sobrepostas. Ajuste os limites para evitar ambiguidade.');return result;}
  s.enabled=boolean(s.enabled,'frete habilitado');
  if(!['flat','regional','profile_table','melhorenvio'].includes(s.rateMode))fail('VALIDATION','Escolha tabela por estado/perfil, cotação automática ou tabela regional.');
  s.flatRateCents=integer(s.flatRateCents,'tarifa única');s.estimatedDays=integer(s.estimatedDays,'prazo',{max:365});
  s.freeShippingEnabled=boolean(s.freeShippingEnabled,'frete grátis');
  s.freeShippingThresholdCents=integer(s.freeShippingThresholdCents,'mínimo para frete grátis',{nullable:!s.freeShippingEnabled,min:1});
  s.regions=ranges(s.regions,'cobertura geral');
  s.origin=Object.fromEntries(ORIGIN_FIELDS.map(key=>[key,text(s.origin[key],'origem '+key,key==='complement'?100:200)]));
  if(s.origin.zip)s.origin.zip=cep(s.origin.zip,'CEP de origem');
  if(s.origin.state&&!Object.values(REGION_STATES).flat().includes(s.origin.state))fail('VALIDATION','UF de origem inválida.');
  if(!Array.isArray(s.packages)||s.packages.length>20)fail('VALIDATION','Cadastre até 20 embalagens reais.');
  const packageIds=new Set();
  s.packages=s.packages.map(row=>{if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).some(key=>!PACKAGE_FIELDS.includes(key)))fail('VALIDATION','Embalagem inválida.');const id=text(row.id,'identificador da embalagem',80),name=text(row.name,'nome da embalagem',100);if(!/^[A-Za-z0-9_-]{1,80}$/.test(id)||packageIds.has(id)||!name)fail('VALIDATION','Informe nomes e identificadores únicos para as embalagens.');packageIds.add(id);const pack={id,name,active:boolean(row.active,'embalagem ativa'),weightGrams:integer(row.weightGrams,'peso embalado em gramas',{min:1,max:30000})};for(const key of ['widthCm','heightCm','lengthCm']){const value=row[key];if(typeof value!=='number'||!Number.isFinite(value)||value<.1||value>300||Math.abs(Math.round(value*10)-value*10)>1e-8)fail('VALIDATION','Medidas devem ter de 0,1 a 300 cm e no máximo uma casa decimal.');pack[key]=value;}return pack;});
  s.defaultPackageId=text(s.defaultPackageId,'embalagem padrão',80);
  if(s.defaultPackageId&&!s.packages.some(row=>row.id===s.defaultPackageId&&row.active))fail('VALIDATION','A embalagem padrão precisa existir e estar ativa.');
  s.packingProfiles=validatePackingProfiles(s.packingProfiles,fail);
  s.packingProfilesValidated=boolean(s.packingProfilesValidated,'confirmação dos perfis');
  if(s.packingProfilesValidatedAt!==null&&(typeof s.packingProfilesValidatedAt!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s.packingProfilesValidatedAt)||!Number.isFinite(Date.parse(s.packingProfilesValidatedAt))||new Date(s.packingProfilesValidatedAt).toISOString().slice(0,10)!==s.packingProfilesValidatedAt||s.packingProfilesValidatedAt>new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'})))fail('VALIDATION','Data da conferência dos perfis inválida ou futura.');
  const previous=shippingSettings(current),packingChanged=JSON.stringify(s.origin)!==JSON.stringify(previous.origin)||JSON.stringify(s.packages)!==JSON.stringify(previous.packages)||s.defaultPackageId!==previous.defaultPackageId||JSON.stringify(s.regions)!==JSON.stringify(previous.regions)||JSON.stringify(s.packingProfiles)!==JSON.stringify(previous.packingProfiles);
  if(s.enabled&&['profile_table','melhorenvio'].includes(s.rateMode)&&packingChanged&&(input.packingProfilesValidated!==true||!input.packingProfilesValidatedAt))fail('VALIDATION','Confirme novamente os perfis após alterar origem, embalagem ou cobertura.');
  s.regionRates=Object.fromEntries(Object.keys(REGION_STATES).map(id=>{
    const rate=s.regionRates[id];
    if(!rate||typeof rate!=='object'||Array.isArray(rate)||Object.keys(rate).some(key=>!RATE_FIELDS.includes(key)))fail('VALIDATION','Tarifa regional inválida.');
    const result={enabled:boolean(rate.enabled,'região '+id),priceCents:integer(rate.priceCents,'preço '+id,{nullable:!rate.enabled}),estimatedDays:integer(rate.estimatedDays,'prazo '+id,{nullable:!rate.enabled,min:rate.enabled?1:0,max:365}),carrier:text(rate.carrier,'transportadora '+id,100),serviceName:text(rate.serviceName,'serviço '+id,100),validated:boolean(rate.validated,'validação operacional '+id),validatedAt:rate.validatedAt||null,cepRanges:ranges(rate.cepRanges,'região '+id)};
    const tariffChanged=['priceCents','estimatedDays','carrier','serviceName','cepRanges'].some(key=>JSON.stringify(result[key])!==JSON.stringify(previous.regionRates[id][key]));
    if(result.enabled&&(packingChanged||tariffChanged)&&(input.regionRates?.[id]?.validated!==true||!input.regionRates[id].validatedAt)){if(s.rateMode==='melhorenvio'){result.validated=false;result.validatedAt=null;}else fail('VALIDATION',`Confirme novamente a tarifa operacional de ${REGION_NAMES[id]} após alterar origem, embalagem, preço, prazo ou cobertura.`);}
    if(result.validatedAt!==null&&(typeof result.validatedAt!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(result.validatedAt)||!Number.isFinite(Date.parse(result.validatedAt))||new Date(result.validatedAt).toISOString().slice(0,10)!==result.validatedAt||result.validatedAt>new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'})))fail('VALIDATION','Data da validação operacional inválida ou futura.');
    if(result.enabled&&s.rateMode!=='melhorenvio'&&(!result.carrier||!result.serviceName||!result.validated||!result.validatedAt))fail('VALIDATION',`Confirme transportadora, serviço, data e tarifa operacional da região ${REGION_NAMES[id]} antes de ativá-la.`);
    return [id,result];
  }));
  if(!s.stateRates||typeof s.stateRates!=='object'||Array.isArray(s.stateRates)||Object.keys(s.stateRates).some(id=>!STATES.includes(id)))fail('VALIDATION','Tabela por estado inválida.');
  s.stateRates=Object.fromEntries(Object.entries(s.stateRates).map(([id,rate])=>{
    if(!rate||typeof rate!=='object'||Array.isArray(rate)||Object.keys(rate).some(key=>!RATE_FIELDS.includes(key)))fail('VALIDATION','Tarifa estadual inválida.');
    const result={enabled:boolean(rate.enabled,'estado '+id),priceCents:integer(rate.priceCents,'preço '+id,{nullable:!rate.enabled}),estimatedDays:integer(rate.estimatedDays,'prazo '+id,{nullable:!rate.enabled,min:rate.enabled?1:0,max:365}),carrier:text(rate.carrier||'','transportadora '+id,100),serviceName:text(rate.serviceName||'','serviço '+id,100),validated:boolean(rate.validated===undefined?false:rate.validated,'validação '+id),validatedAt:rate.validatedAt||null,cepRanges:ranges(rate.cepRanges||[],'estado '+id)};
    const changed=JSON.stringify(result)!==JSON.stringify(previous.stateRates[id]);
    if(result.validatedAt!==null&&(typeof result.validatedAt!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(result.validatedAt)||!Number.isFinite(Date.parse(result.validatedAt))||new Date(result.validatedAt).toISOString().slice(0,10)!==result.validatedAt||result.validatedAt>new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'})))fail('VALIDATION','Data da validação estadual inválida ou futura.');
    if(result.enabled&&(packingChanged||changed)&&(input.stateRates?.[id]?.validated!==true||!input.stateRates[id].validatedAt)){if(s.rateMode!=='profile_table'){result.validated=false;result.validatedAt=null;}else fail('VALIDATION','Confirme novamente a tarifa de '+id+' após alterar a configuração.');}
    if(result.enabled&&s.rateMode==='profile_table'&&(!result.carrier||!result.serviceName||!result.validated||!result.validatedAt))fail('VALIDATION','Informe e confirme serviço, tarifa, prazo e data de '+id+'.');
    return [id,result];
  }));
  s.pickup={enabled:boolean(s.pickup.enabled,'retirada na loja')};
  s.localDelivery={enabled:boolean(s.localDelivery.enabled,'entrega em Uberlândia'),estimatedDays:integer(s.localDelivery.estimatedDays,'prazo local',{nullable:true,max:365})};
  const hasLocality=!!String(store.city||'').trim()&&Object.values(REGION_STATES).some(states=>states.includes(store.state));
  if((s.pickup.enabled||s.localDelivery.enabled)&&(!(hasLocality||String(store.address||'').trim())||!/^\d{10,13}$/.test(String(store.whatsapp||'').replace(/\D/g,''))))fail('VALIDATION','Cadastre a cidade/UF da loja e o WhatsApp antes de habilitar retirada ou entrega local. O endereço exato da retirada pode ser combinado após o pagamento.');
  if(s.localDelivery.enabled&&(!hasLocality||normalized(store.city)!=='uberlandia'||store.state!=='MG'))fail('VALIDATION','A entrega local gratuita exige que a localidade da loja esteja configurada como Uberlândia/MG.');
  if(s.enabled&&['regional','profile_table','melhorenvio'].includes(s.rateMode)){const readiness=operationalShippingReadiness(s);if(!readiness.nationalReady)fail('VALIDATION','Envio nacional não está pronto: '+readiness.missing.join('; ')+'.');}
  if(s.enabled&&s.rateMode==='melhorenvio'&&(!shippingReadiness({...env,MELHOR_ENVIO_ORIGIN_ZIP:s.origin.zip}).enabled||env.BKM_ENVIRONMENT==='production'&&env.MELHOR_ENVIO_ENVIRONMENT!=='production'))fail('VALIDATION','Conecte uma credencial autorizada do Melhor Envio no ambiente correto antes de ativar a cotação automática.');
  return s;
}
function hasConfiguredShipping(raw,{production=false,env={}}={}) {
  const s=shippingSettings(raw);
  return !!(s.pickup.enabled||s.localDelivery.enabled||(s.enabled&&(['regional','profile_table','melhorenvio'].includes(s.rateMode)?operationalShippingReadiness(s).nationalReady&&(s.rateMode!=='melhorenvio'||shippingReadiness({...env,MELHOR_ENVIO_ORIGIN_ZIP:s.origin.zip}).enabled&&(!production||env.MELHOR_ENVIO_ENVIRONMENT==='production')):!production)));
}
function createShippingPolicy({ApiError,fetchImpl=globalThis.fetch,carrierFetch=globalThis.fetch,env={},now=()=>Date.now(),production=false}={}) {
  const cache=new Map(),pending=new Map(),quotesCache=new Map(),quoteFlights=new Map();
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
  async function quote({settings:raw,netCents,cep:rawCep,deliveryMode='delivery',address={},items=[],shippingOptionId=null}) {
    const s=shippingSettings(raw),cep=String(rawCep||'').replace(/\D/g,'');
    if(!Number.isSafeInteger(netCents)||netCents<0)fail(422,'SHIPPING_AMOUNT','O valor dos produtos após descontos precisa ser válido.');
    if(!address||typeof address!=='object'||Array.isArray(address))fail(422,'ADDRESS','Endereço inválido.');
    if(!['delivery','pickup','local'].includes(deliveryMode))fail(422,'SHIPPING_METHOD','Escolha uma modalidade de entrega válida.');
    if(cep&&!/^\d{8}$/.test(cep))fail(422,'INVALID_CEP','Informe um CEP com oito números.');
    const base={available:false,reason:null,cep,free:false,estimatedDays:null,deliveryMode,destination:null,regionId:null,freeShippingThresholdCents:s.freeShippingEnabled?s.freeShippingThresholdCents:null,remainingForFreeShippingCents:s.enabled&&s.freeShippingEnabled?Math.max(0,s.freeShippingThresholdCents-netCents):null};
    const unavailable=reason=>({...base,reason,shippingCents:null});
    if(deliveryMode==='pickup')return s.pickup.enabled?{...base,available:true,shippingCents:0,free:true,estimatedDays:0}:unavailable('Retirada na loja indisponível.');
    if(deliveryMode==='local'&&!s.localDelivery.enabled)return unavailable('Entrega local indisponível.');
    if(!s.enabled&&!s.localDelivery.enabled)return unavailable('Frete ainda não configurado pela loja.');
    if(!cep)return unavailable('Informe o CEP para calcular a entrega.');
    const requiresVerified=production||['regional','profile_table','melhorenvio'].includes(s.rateMode)||s.localDelivery.enabled;
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
    if((production||['regional','profile_table','melhorenvio'].includes(s.rateMode))&&(!['regional','profile_table','melhorenvio'].includes(s.rateMode)||!operationalShippingReadiness(s).nationalReady))return unavailable('Envio nacional indisponível: a origem, a embalagem ou as tarifas operacionais ainda não foram validadas pela loja.');
    if(['profile_table','melhorenvio'].includes(s.rateMode))return profileQuote({s,base,found,cep,netCents,items,shippingOptionId,unavailable});
    const rate=s.rateMode==='regional'?s.regionRates[found.regionId]:{enabled:true,priceCents:s.flatRateCents,estimatedDays:s.estimatedDays};
    if(!rate?.enabled||!Number.isSafeInteger(rate.priceCents)||!Number.isSafeInteger(rate.estimatedDays))return unavailable('Entrega indisponível para esta região.');
    if(rate.cepRanges?.length&&!rate.cepRanges.some(range=>cep>=range.start&&cep<=range.end))return unavailable('Entrega indisponível para esta faixa de CEP.');
    const free=!!(s.freeShippingEnabled&&netCents>=s.freeShippingThresholdCents);
    const id='store:regional:'+(found?.regionId||'flat');if(shippingOptionId&&shippingOptionId!==id)fail(422,'SHIPPING_OPTION_CHANGED','A opção de frete mudou. Calcule novamente.');
    const option={id,carrier:rate.carrier||null,serviceName:rate.serviceName||'Entrega da loja',priceCents:free?0:rate.priceCents,originalPriceCents:rate.priceCents,estimatedDays:rate.estimatedDays,free,provider:'store_validated_manual'};
    return {...base,available:true,shippingCents:option.priceCents,free,estimatedDays:rate.estimatedDays,carrier:option.carrier,serviceName:option.serviceName,provider:option.provider,selectedOptionId:id,options:[option]};
  }
  async function profileQuote({s,base,found,cep,netCents,items,shippingOptionId,unavailable}){
    const plan=packingPlan(s,items,netCents);if(!plan.available)return unavailable(plan.reason);
    const free=!!(s.freeShippingEnabled&&netCents>=s.freeShippingThresholdCents),packing=plan.summary.map(({profileId,name,quantity,volumes})=>({profileId,name,quantity,volumes}));
    let options=[],expiresAt=null;
    if(s.rateMode==='profile_table'){
      const rate=Object.hasOwn(s.stateRates,found.state)?s.stateRates[found.state]:s.regionRates[found.regionId];
      if(!rate?.enabled||!rate.validated||!rate.validatedAt||!Number.isSafeInteger(rate.priceCents)||!Number.isSafeInteger(rate.estimatedDays)||rate.estimatedDays<1)return unavailable('Entrega indisponível para este estado.');
      if(rate.cepRanges?.length&&!rate.cepRanges.some(range=>cep>=range.start&&cep<=range.end))return unavailable('Entrega indisponível para esta faixa de CEP.');
      const amount=plan.summary.reduce((sum,row)=>sum+(rate.priceCents+row.basePriceCents)*row.volumes,0);if(!Number.isSafeInteger(amount)||amount>100000000)return unavailable('Este carrinho precisa de uma cotação de envio pela loja.');
      options=[{id:'store:profile:'+found.state,carrier:rate.carrier,serviceName:rate.serviceName,priceCents:free?0:amount,originalPriceCents:amount,estimatedDays:rate.estimatedDays,free,provider:'store_profile_table'}];
    }else{
      const providerEnv={...env,MELHOR_ENVIO_ORIGIN_ZIP:s.origin.zip},ready=shippingReadiness(providerEnv);
      if(!ready.enabled||production&&ready.environment!=='production')return unavailable('Cotação automática indisponível: conecte o Melhor Envio no ambiente correto.');
      const services=String(env.MELHOR_ENVIO_SERVICES||'').split(',').filter(Boolean).map(value=>Number(value.trim()));
      if(services.length>30||services.some(id=>!Number.isSafeInteger(id)||id<1||id>9999))return unavailable('A seleção de serviços da transportadora precisa ser revisada pela loja.');
      const key=JSON.stringify([s.origin.zip,cep,plan.volumes,services,ready.environment]);let cached=quotesCache.get(key);
      if(!cached||cached.until<=now()){
        if(!quoteFlights.has(key)){const flight=createShippingProvider({env:providerEnv,fetchImpl:carrierFetch,now}).quote({zip:cep,volumes:plan.volumes,services}).then(result=>{const value={result,until:now()+120000};if(quotesCache.size>=200)quotesCache.delete(quotesCache.keys().next().value);quotesCache.set(key,value);return value;}).finally(()=>quoteFlights.delete(key));quoteFlights.set(key,flight);}
        try{cached=await quoteFlights.get(key);}catch{return unavailable('Não foi possível consultar as transportadoras agora. Tente calcular novamente.');}
      }
      expiresAt=new Date(cached.until).toISOString();
      options=cached.result.quotes.map(row=>({id:'melhorenvio:'+row.serviceId,serviceId:row.serviceId,carrier:row.company||'Transportadora',serviceName:row.name,priceCents:row.amountCents,originalPriceCents:row.amountCents,estimatedDays:row.estimatedDays,free:false,provider:'melhorenvio',environment:ready.environment,sandbox:ready.environment==='sandbox'})).sort((a,b)=>a.priceCents-b.priceCents||a.estimatedDays-b.estimatedDays||a.id.localeCompare(b.id));
      if(!options.length)return unavailable('Nenhuma transportadora está disponível para este CEP e embalagem.');
      // The benefit covers the cheapest service; faster upgrades only charge
      // the difference, avoiding an unlimited subsidy for premium deliveries.
      if(free){const benefit=options[0].originalPriceCents;options=options.map(row=>({...row,priceCents:row.originalPriceCents-benefit,free:row.originalPriceCents===benefit}));}
    }
    const selected=shippingOptionId?options.find(row=>row.id===shippingOptionId):options[0];
    if(!selected)fail(422,'SHIPPING_OPTION_CHANGED','Esta opção de frete não está mais disponível. Calcule novamente e escolha uma opção atual.');
    return {...base,available:true,shippingCents:selected.priceCents,free:selected.free,shippingBenefitCents:selected.originalPriceCents-selected.priceCents,estimatedDays:selected.estimatedDays,carrier:selected.carrier,serviceName:selected.serviceName,provider:selected.provider,selectedOptionId:selected.id,options,packing,volumeCount:plan.volumeCount,quoteExpiresAt:expiresAt,demo:selected.sandbox===true};
  }
  return {quote,destination};
}
module.exports={REGION_STATES,REGION_NAMES,UBERLANDIA_IBGE,shippingSettings,validateShippingSettings,hasConfiguredShipping,createShippingPolicy,operationalShippingReadiness,publicShippingSettings};
