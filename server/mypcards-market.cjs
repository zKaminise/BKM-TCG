'use strict';

// Only the documented MYP Cards API is used. Market values aggregate PT/EN
// listings; a verified printing is not a verification of condition or finish.
const crypto=require('node:crypto');
const {setTimeout:pause}=require('node:timers/promises');
const ROOT='https://mypcards.com/api/v1',DAY=86400000,MISS=6*3600000,RETRY=5*60000,MAX_BYTES=2*1024*1024;
const ID=/^[a-zA-Z0-9][a-zA-Z0-9.+_-]{0,179}$/;
const normalize=value=>String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
const number=value=>String(value??'').trim().toUpperCase().replace(/\d+/g,digits=>digits.replace(/^0+(?=\d)/,''));
const safeText=(value,max=250)=>typeof value==='string'&&!/[\u0000-\u001f\u007f]/.test(value)&&value.trim().length<=max?value.trim():'';
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const parse=value=>{try{return JSON.parse(value);}catch{return null;}};
function minorUnits(value){
 if(typeof value!=='number'&&typeof value!=='string')return null;
 const text=String(value);if(!/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(text))return null;
 const [whole,fraction='']=text.split('.'),amount=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 return Number.isSafeInteger(amount)&&amount>0&&amount<=100000000?amount:null;
}
function canonical(card={}){
 const meta=card.card||card,cardId=card.cardId||meta.providerId||meta.id,ref=card.referenceLanguage||meta.referenceLanguage||meta.language||card.language;
 const value={cardId,setId:card.setId||meta.setId,referenceLanguage:ref,name:safeText(meta.name,180),setName:safeText(meta.setName,200),setCode:safeText(meta.setCode,80),number:safeText(meta.number||meta.localNumber||String(meta.displayNumber||'').split('/')[0],40),total:meta.total??meta.printedTotal??null};
 value.valid=ID.test(value.cardId||'')&&ID.test(value.setId||'')&&!!value.name&&!!value.setName&&/^[A-Za-z]{0,8}\d{1,8}[A-Za-z]{0,4}$/.test(value.number);
 return value;
}
function mypPriceKey(card){const identity=canonical(card);return `myp:price:v1:${identity.referenceLanguage}|${identity.cardId}`;}
function mypCodePath(code){
 if(typeof code!=='string'||!code.trim()||code.length>180||/[\u0000-\u001f\u007f]/.test(code))throw new Error('Código MYP inválido.');
 return '/pokemon/precos/'+encodeURIComponent(Buffer.from(code.trim(),'utf8').toString('base64'));
}
function sourceUrl(value,id){
 try{const url=new URL(value),decoded=decodeURIComponent(url.pathname);if(url.protocol!=='https:'||!['mypcards.com','www.mypcards.com'].includes(url.hostname)||url.port||url.username||url.password||url.search||url.hash||url.href.length>2000||!url.pathname.startsWith('/pokemon/')||/[\u0000-\u001f\u007f\\]/.test(decoded)||decoded.split('/').some(part=>part==='.'||part==='..'))return '';return url.href;}catch{return '';}
}
function product(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||!Number.isSafeInteger(raw.internal_code)||raw.internal_code<=0||raw.id_marca!==2)return null;
 const code=safeText(raw.card_code,180),pt=safeText(raw.name_pt),en=safeText(raw.name_en),editionPt=safeText(raw.edition_pt),editionEn=safeText(raw.edition_en),editionCode=safeText(raw.edition_code,80),url=sourceUrl(raw.link,raw.internal_code);
 if(!code||!pt&&!en||!editionPt&&!editionEn&&!editionCode||!url)return null;
 return {internal_code:raw.internal_code,card_code:code,name_pt:pt,name_en:en,edition_pt:editionPt,edition_en:editionEn,edition_code:editionCode,id_marca:2,deck_labels:Array.isArray(raw.deck_labels)?raw.deck_labels.map(value=>safeText(value,500)).filter(Boolean).slice(0,50):[],minPriceCents:minorUnits(raw.min_price),avgPriceCents:minorUnits(raw.avg_price),link:url};
}
function numberEvidence(candidate){
 const output=[];
 const take=text=>{const match=text.match(/(?:^|[\s:#(-])([A-Za-z]{0,8}\d{1,8}[A-Za-z]{0,4})(?:\s*\/\s*([A-Za-z]{0,8}\d{1,8}[A-Za-z]{0,4}))?\s*[)\]]*$/);if(match)output.push({number:number(match[1]),total:match[2]?number(match[2]):null});};
 take(candidate.card_code);
 for(const label of candidate.deck_labels){const normalized=normalize(label),names=[candidate.name_pt,candidate.name_en].filter(Boolean).map(normalize);if(!names.some(name=>normalized.startsWith(name+' ')))continue;
  const rest=normalized.slice(names.find(name=>normalized.startsWith(name+' ')).length).trim(),editions=[candidate.edition_code,candidate.edition_pt,candidate.edition_en].filter(Boolean).map(normalize);
  if(editions.some(edition=>rest.startsWith(edition+' ')))take(label);
 }
 return output;
}
function matchProduct(card,candidates){
 const identity=canonical(card);if(!identity.valid)return {status:'INCOMPATIBLE',product:null,reason:'Identidade da carta incompleta para conferir a impressão brasileira.'};
 const wantedName=normalize(identity.name),wantedNumber=number(identity.number),wantedTotal=identity.total==null?null:number(identity.total),setNames=[identity.setName].map(normalize),setCodes=[identity.setCode].filter(Boolean).map(normalize);
 const matching=new Map();
 for(const candidate of candidates){
  if(![candidate.name_pt,candidate.name_en].some(value=>normalize(value)===wantedName))continue;
  const nameMatch=[candidate.edition_pt,candidate.edition_en].some(value=>value&&setNames.includes(normalize(value))),codeMatch=candidate.edition_code&&setCodes.includes(normalize(candidate.edition_code));
  if(!nameMatch&&!codeMatch)continue;
  const evidence=numberEvidence(candidate);if(!evidence.length||evidence.some(value=>value.number!==wantedNumber||value.total&&wantedTotal&&value.total!==wantedTotal))continue;
  matching.set(candidate.internal_code,{product:candidate,metadata:{method:'name_edition_number',name:identity.name,editionCode:candidate.edition_code,editionName:identity.setName,number:identity.number,total:identity.total,editionMatchedBy:nameMatch?'name':'code',numberSources:evidence}});
 }
 if(matching.size>1)return {status:'AMBIGUOUS',product:null,reason:'Mais de um produto corresponde à identidade. Nenhum preço foi escolhido automaticamente.'};
 if(!matching.size)return {status:'NO_MATCH',product:null,reason:'Não encontramos uma correspondência segura de nome, edição e número no MYP Cards.'};
 return {status:'MATCHED',...matching.values().next().value};
}
function selectMypReference(reference,item={},now=Date.now()){
 if(!reference||typeof reference!=='object'||reference.source!=='mypcards')return null;
 const identity=canonical(item),lang=item.language||identity.referenceLanguage;
 if(!['pt','en'].includes(lang)||!['pt','en'].includes(identity.referenceLanguage)||lang!==identity.referenceLanguage)return null;
 if(reference.cardId!==identity.cardId||reference.setId!==identity.setId||reference.referenceLanguage!==identity.referenceLanguage)return null;
 const fetched=Date.parse(reference.fetchedAt),stale=reference.stale===true||!Number.isFinite(fetched)||fetched>now||now-fetched>=DAY||!Number.isFinite(Date.parse(reference.expiresAt))||Date.parse(reference.expiresAt)<=now;
 const ordinary=['NORMAL','HOLO','REVERSE'].includes(item.variant||'NORMAL')&&(item.attributes==null||Array.isArray(item.attributes)&&!item.attributes.length);
 const valid=reference.status==='MATCHED'&&reference.match==='PRINTING_EXACT'&&reference.currency==='BRL'&&Number.isSafeInteger(reference.avgPriceCents)&&reference.avgPriceCents>0&&reference.avgPriceCents<=100000000;
 return {...reference,stale,conditionAdjusted:false,usableForBrlValuation:valid&&!stale&&ordinary,unavailableReason:!ordinary?'A referência agrega condições e acabamentos; não avalia este atributo ou acabamento especial.':stale?'Referência desatualizada; excluída da estimativa atual.':!valid?reference.reason||'Sem preço médio anunciado disponível para esta impressão.':null};
}
class LookupError extends Error{constructor(status,reason,retryAt){super(reason);Object.assign(this,{status,reason,retryAt});}}
function createMypCardsProvider({db,fetchImpl=globalThis.fetch,env={},now=Date.now,timeoutMs=4500}={}){
 if(!db?.prepare||!db?.transaction)throw new Error('Cache persistente é necessário para o MYP Cards.');
 const token=typeof env.MYP_CARDS_API_TOKEN==='string'&&env.MYP_CARDS_API_TOKEN.trim().length<=4096&&!/[\u0000-\u001f\u007f]/.test(env.MYP_CARDS_API_TOKEN)?env.MYP_CARDS_API_TOKEN.trim():'';
 const flights=new Map(),requests=new Map(),owner=crypto.randomUUID(),baseLimit=token?60:10,enabled=env.MYP_CARDS_ENABLED!=='false',stamp=()=>new Date(now()).toISOString(),lock=db.lockSuffix||'';
 const read=async key=>{const row=await db.prepare('SELECT * FROM personal_reference_cache WHERE cache_key=?').get(key);return row?{row,data:parse(row.payload_json)}:null;};
 async function write(key,kind,lang,id,data,expiresAt){await db.prepare('INSERT INTO personal_reference_cache(cache_key,kind,language,reference_id,payload_json,fetched_at,expires_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(cache_key) DO UPDATE SET payload_json=excluded.payload_json,fetched_at=excluded.fetched_at,expires_at=excluded.expires_at').run(key,kind,lang,id,JSON.stringify(data),now(),expiresAt);}
 async function ensure(key,kind,id){await db.prepare('INSERT INTO personal_reference_cache(cache_key,kind,language,reference_id,payload_json,fetched_at,expires_at) VALUES(?,?,\'\',?,\'{}\',?,?) ON CONFLICT(cache_key) DO NOTHING').run(key,kind,id,now(),now());}
 const rateKey=route=>'myp:rate:v1:'+route;
 async function reserve(route){return db.transaction(async()=>{
  await ensure(rateKey('global'),'myp-rate','global');const global=await db.prepare('SELECT * FROM personal_reference_cache WHERE cache_key=?'+lock).get(rateKey('global')),globalState=parse(global.payload_json)||{};
  if(globalState.blockedUntil>now())throw new LookupError('UNAVAILABLE','O acesso à API MYP Cards está temporariamente indisponível.',globalState.blockedUntil);
  const key=rateKey(route);await ensure(key,'myp-rate',route);const row=await db.prepare('SELECT * FROM personal_reference_cache WHERE cache_key=?'+lock).get(key);let state=parse(row.payload_json)||{};
  if(state.blockedUntil>now())throw new LookupError('RATE_LIMITED','Aguarde o prazo de retomada informado pelo MYP Cards.',state.blockedUntil);
  if(!Number.isFinite(state.windowStart)||now()-state.windowStart>=60000||state.windowStart>now())state={windowStart:now(),count:0,limit:baseLimit,blockedUntil:0};
  if(state.blockedUntil>now()||state.count>=Math.min(baseLimit,state.limit||baseLimit))throw new LookupError('RATE_LIMITED','Limite de consultas MYP Cards atingido. Aguarde a próxima janela.',Math.max(state.blockedUntil||0,state.windowStart+60000));
  state.count++;await write(key,'myp-rate','',route,state,state.windowStart+60000);return state;
 });}
 async function responseState(route,response){
  const header=name=>response.headers?.get?.(name),status=response.status,rawRetry=header('retry-after');let retryAt=now()+60000;
  if(rawRetry){const seconds=Number(rawRetry),absolute=Date.parse(rawRetry);if(Number.isFinite(seconds)&&seconds>=0)retryAt=now()+Math.min(seconds*1000,DAY);else if(Number.isFinite(absolute))retryAt=Math.max(now()+1000,Math.min(absolute,now()+DAY));}
  await db.transaction(async()=>{
   // Match reservation's lock order (global, then route), including on 403.
   await ensure(rateKey('global'),'myp-rate','global');await db.prepare('SELECT cache_key FROM personal_reference_cache WHERE cache_key=?'+lock).get(rateKey('global'));
   const key=rateKey(route),row=await db.prepare('SELECT * FROM personal_reference_cache WHERE cache_key=?'+lock).get(key);if(!row)return;const state=parse(row.payload_json)||{},limit=Number(header('x-rate-limit-limit')),remaining=Number(header('x-rate-limit-remaining'));
   if(header('x-rate-limit-limit')&&Number.isInteger(limit)&&limit>0&&limit<=60)state.limit=Math.min(baseLimit,limit);
   if(header('x-rate-limit-remaining')&&Number.isInteger(remaining)&&remaining>=0&&remaining<=(state.limit||baseLimit))state.count=Math.max(state.count||0,(state.limit||baseLimit)-remaining);
   if(status===429)state.blockedUntil=Math.max(state.blockedUntil||0,retryAt);
   else if(header('x-rate-limit-remaining')&&remaining===0)state.blockedUntil=Math.max(state.blockedUntil||0,(state.windowStart||now())+60000);
   await write(key,'myp-rate','',route,state,Math.max(state.blockedUntil||0,(state.windowStart||now())+60000));
   if(status===403)await write(rateKey('global'),'myp-rate','','global',{blockedUntil:now()+RETRY},now()+RETRY);
  });
  return retryAt;
 }
 async function readJson(response){
  const contentType=response.headers?.get?.('content-type');if(contentType&&!/application\/(?:[\w.+-]+\+)?json/i.test(contentType))throw new LookupError('UNAVAILABLE','A API MYP Cards não retornou dados JSON.');
  if(Number(response.headers?.get?.('content-length'))>MAX_BYTES)throw new LookupError('UNAVAILABLE','A resposta da API MYP Cards excedeu o limite seguro.');
  if(!response.body?.getReader){const raw=typeof response.text==='function'?await response.text():JSON.stringify(await response.json());if(Buffer.byteLength(raw)>MAX_BYTES)throw new LookupError('UNAVAILABLE','Resposta MYP Cards muito grande.');return JSON.parse(raw);}
  const reader=response.body.getReader(),chunks=[];let bytes=0;try{while(true){const next=await reader.read();if(next.done)break;bytes+=next.value.length;if(bytes>MAX_BYTES){await reader.cancel();throw new LookupError('UNAVAILABLE','Resposta MYP Cards muito grande.');}chunks.push(next.value);}return JSON.parse(Buffer.concat(chunks,bytes).toString('utf8'));}finally{reader.releaseLock();}
 }
 async function request(path,route){
  await reserve(route);const controller=new AbortController();let timer;
  const deadline=new Promise((resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new LookupError('UNAVAILABLE','A consulta MYP Cards excedeu o tempo disponível.'));},Math.max(1,Math.min(15000,timeoutMs)));});
  try{return await Promise.race([deadline,(async()=>{
   const response=await fetchImpl(ROOT+path,{method:'GET',redirect:'error',signal:controller.signal,headers:{Accept:'application/json','User-Agent':'BKM-TCG-Market/2.1',...(token?{'X-Api-Token':token}:{})}});if(controller.signal.aborted)throw new LookupError('UNAVAILABLE','A consulta MYP Cards foi interrompida.');const retryAt=await responseState(route,response);
   if(response.status===429){await response.body?.cancel?.();throw new LookupError('RATE_LIMITED','A API MYP Cards limitou as consultas. Tente novamente mais tarde.',retryAt);}
   if(!response.ok){await response.body?.cancel?.();throw new LookupError(response.status===404?'NO_MATCH':'UNAVAILABLE',response.status===403?'A proteção do MYP Cards recusou o acesso à API. É necessário acesso autorizado pelo provedor.':'A API MYP Cards está indisponível no momento.',now()+(response.status===404?MISS:RETRY));}
   const data=await readJson(response);if(!data||typeof data!=='object'||data.error||data.status>=400)throw new LookupError('UNAVAILABLE','A API MYP Cards retornou dados inválidos.');return data;
  })()]);}catch(error){if(error instanceof LookupError)throw error;throw new LookupError('UNAVAILABLE','Não foi possível consultar a API MYP Cards agora.',now()+RETRY);}finally{clearTimeout(timer);}
 }
 async function acquire(key){return db.transaction(async()=>{
  const leaseKey='myp:lease:v1:'+digest(key);await ensure(leaseKey,'myp-lease',digest(key));const row=await db.prepare('SELECT * FROM personal_reference_cache WHERE cache_key=?'+lock).get(leaseKey),state=parse(row.payload_json)||{};
  if(state.until>now())return false;
  await write(leaseKey,'myp-lease','',digest(key),{owner,until:now()+Math.max(2000,timeoutMs+1000)},now()+Math.max(2000,timeoutMs+1000));return true;
 });}
 async function release(key){return db.transaction(async()=>{const leaseKey='myp:lease:v1:'+digest(key),row=await db.prepare('SELECT * FROM personal_reference_cache WHERE cache_key=?'+lock).get(leaseKey);if(parse(row?.payload_json)?.owner===owner)await db.prepare('DELETE FROM personal_reference_cache WHERE cache_key=?').run(leaseKey);});}
 async function cachedRequest(key,path,route,list){
  if(requests.has(key))return requests.get(key);
  const flight=(async()=>{
   const saved=await read(key);if(saved?.data&&Number(saved.row.expires_at)>now()){if(saved.data.error)throw new LookupError(saved.data.error.status,saved.data.error.reason,Number(saved.row.expires_at));return saved.data;}
   if(!await acquire(key)){for(let n=0;n<4;n++){await pause(50);const ready=await read(key);if(ready?.data&&Number(ready.row.expires_at)>now()){if(ready.data.error)throw new LookupError(ready.data.error.status,ready.data.error.reason,Number(ready.row.expires_at));return ready.data;}}throw new LookupError('UNAVAILABLE','Uma consulta MYP Cards está em andamento. Tente novamente em instantes.',now()+1000);}
   try{
    // Another instance may have completed between the initial read and lease.
    const ready=await read(key);if(ready?.data&&Number(ready.row.expires_at)>now()){if(ready.data.error)throw new LookupError(ready.data.error.status,ready.data.error.reason,Number(ready.row.expires_at));return ready.data;}
    const response=await request(path,route),raw=list?response.cards:[response];if(!Array.isArray(raw)||raw.length>2000)throw new LookupError('UNAVAILABLE','A API MYP Cards retornou uma lista inválida.');
    const records=raw.map(product).filter(Boolean);if(raw.length&&!records.length)throw new LookupError('UNAVAILABLE','A API MYP Cards não retornou produtos Pokémon identificáveis.');
    const fetchedAt=stamp(),expiresAt=now()+(records.length?DAY:MISS),data={records,fetchedAt,expiresAt:new Date(expiresAt).toISOString()};
    await db.transaction(()=>write(key,'myp-api','pt-en',digest(path),data,expiresAt));return data;
   }catch(error){const failure=error instanceof LookupError?error:new LookupError('UNAVAILABLE','Não foi possível consultar o MYP Cards agora.'),until=Math.max(now()+1000,failure.retryAt||now()+(failure.status==='NO_MATCH'?MISS:RETRY));await db.transaction(()=>write(key,'myp-api','pt-en',digest(path),{error:{status:failure.status,reason:failure.reason}},until));throw new LookupError(failure.status,failure.reason,until);
   }finally{await release(key);}
  })();requests.set(key,flight);try{return await flight;}finally{requests.delete(key);}
 }
 function empty(identity,status,reason){return {source:'mypcards',sourceLabel:'MYP Cards',currency:'BRL',status,match:null,cardId:identity.cardId||'',setId:identity.setId||'',referenceLanguage:identity.referenceLanguage||'',productId:null,cardCode:null,minPriceCents:null,avgPriceCents:null,valueCents:null,sourceUrl:'',attributionUrl:'https://mypcards.com',fetchedAt:null,quotedAt:null,quotedAtKind:'retrieved',expiresAt:null,stale:false,aggregate:true,condition:null,variant:null,marketLanguages:['pt','en'],matchMetadata:null,reason};}
 function withStaleness(reference){const fetched=Date.parse(reference.fetchedAt);return {...reference,stale:reference.stale===true||reference.status==='MATCHED'&&(!Number.isFinite(fetched)||fetched>now()||now()-fetched>=DAY||!Number.isFinite(Date.parse(reference.expiresAt))||Date.parse(reference.expiresAt)<=now())};}
 async function saveReference(card,identity,key,data){
  const match=matchProduct(card,data.records),quote=empty(identity,match.status,match.reason);
  Object.assign(quote,{fetchedAt:data.fetchedAt,quotedAt:data.fetchedAt,expiresAt:data.expiresAt});
  if(match.product){const value=match.product;Object.assign(quote,{match:'PRINTING_EXACT',productId:value.internal_code,cardCode:value.card_code,minPriceCents:value.minPriceCents,avgPriceCents:value.avgPriceCents,valueCents:value.avgPriceCents,sourceUrl:value.link,matchMetadata:match.metadata,reason:value.minPriceCents===null&&value.avgPriceCents===null?'Esta impressão não tem preços de anúncios PT/EN disponíveis.':undefined});}
  const until=match.status==='MATCHED'?Date.parse(data.expiresAt):Math.min(Date.parse(data.expiresAt),now()+MISS);quote.expiresAt=new Date(until).toISOString();await db.transaction(()=>write(key,'myp-price',identity.referenceLanguage,identity.cardId,quote,until));return withStaleness(quote);
 }
 async function getReference(card,{allowFetch=true,physicalLanguage}={}){
  const identity=canonical(card),physical=physicalLanguage||card.language||identity.referenceLanguage;
  if(!identity.valid||!['pt','en'].includes(identity.referenceLanguage)||physical!==identity.referenceLanguage)return empty(identity,'INCOMPATIBLE','Não há referência brasileira PT/EN verificável para esta identidade e idioma físico.');
  const key=mypPriceKey(card);if(flights.has(key))return flights.get(key);
  const flight=(async()=>{
   const saved=await read(key),payload=saved?.data,previous=payload?.source==='mypcards'&&payload.cardId===identity.cardId&&payload.setId===identity.setId&&payload.referenceLanguage===identity.referenceLanguage?payload:null;
   if(previous&&Number(saved.row.expires_at)>now())return withStaleness(previous);
   if(!allowFetch||!enabled){
    // One exact-name response can resolve a page of printings without another
    // HTTP call. Keep the source retrieval time, rather than renewing its age.
    const shared=await read('myp:api:name:v1:'+normalize(identity.name));
    if(shared?.data&&Number(shared.row.expires_at)>now()&&Array.isArray(shared.data.records))return saveReference(card,identity,key,shared.data);
    return previous?.source==='mypcards'?withStaleness(previous):empty(identity,'UNAVAILABLE','Referência brasileira ainda não consultada.');
   }
   try{
    let data;
    if(previous?.match==='PRINTING_EXACT'&&Number.isSafeInteger(previous.productId)&&previous.productId>0)data=await cachedRequest('myp:api:product:v1:'+previous.productId,'/produto/'+previous.productId,'product',false);
    else data=await cachedRequest('myp:api:name:v1:'+normalize(identity.name),'/pokemon/carta/'+encodeURIComponent(identity.name),'name',true);
    return saveReference(card,identity,key,data);
   }catch(error){const failure=error instanceof LookupError?error:new LookupError('UNAVAILABLE','Não foi possível consultar a referência brasileira agora.'),until=Math.max(now()+1000,failure.retryAt||now()+RETRY);
    const fallback=previous?.match==='PRINTING_EXACT'?{...previous,stale:true,lastError:failure.status,reason:'Último valor conhecido; a atualização MYP Cards está indisponível.'}:empty(identity,failure.status,failure.reason);
    if(!fallback.expiresAt)fallback.expiresAt=new Date(until).toISOString();await db.transaction(()=>write(key,'myp-price',identity.referenceLanguage,identity.cardId,fallback,until));return fallback;
   }
  })();flights.set(key,flight);try{return await flight;}finally{flights.delete(key);}
 }
 async function getCachedReferences(items=[]){
  if(!Array.isArray(items)||items.length>10000)throw new Error('Consulte até 10.000 identidades MYP por leitura.');
  const wanted=new Map();for(const item of items){const identity=canonical(item);if(ID.test(identity.cardId||'')&&ID.test(identity.setId||'')&&['pt','en'].includes(identity.referenceLanguage))wanted.set(mypPriceKey(item),identity);}
  const keys=[...wanted.keys()],output=new Map();
  for(let start=0;start<keys.length;start+=500){const chunk=keys.slice(start,start+500),rows=await db.prepare('SELECT * FROM personal_reference_cache WHERE cache_key IN ('+chunk.map(()=>'?').join(',')+')').all(...chunk);for(const row of rows){const data=parse(row.payload_json),identity=wanted.get(row.cache_key);if(data?.source==='mypcards'&&data.cardId===identity.cardId&&data.setId===identity.setId&&data.referenceLanguage===identity.referenceLanguage)output.set(identity.referenceLanguage+'|'+identity.cardId,withStaleness(data));}}
  return output;
 }
 return {getReference,getCachedReferences,id:'mypcards',automated:true,configured:enabled,enabled,tokenConfigured:!!token,ttlHours:24};
}
module.exports={createMypCardsProvider,selectMypReference,mypPriceKey,mypCodePath,matchProduct,minorUnits};
