'use strict';

// PTAX is used only to convert an explicitly international price reference.
// A currency conversion does not turn it into a Brazilian marketplace price.
const crypto=require('node:crypto');
const {setTimeout:pause}=require('node:timers/promises');
const {selectInternationalMarket}=require('./tcgdex-market.cjs');
const DAY=86400000,TTL=6*3600000,RETRY=5*60000,MAX_BYTES=128*1024;
const ROOT='https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/';
const CURRENCIES=['EUR','USD'];
const parse=value=>{try{return JSON.parse(value);}catch{return null;}};
const fxRateKey=currency=>'fx:rate:v1:'+currency;
function rateMicros(value){
 if(typeof value!=='number'&&typeof value!=='string')return null;
 const text=String(value);if(!/^(?:0|[1-9]\d{0,3})(?:\.\d{1,6})?$/.test(text))return null;
 const [whole,fraction='']=text.split('.'),micros=Number(whole)*1000000+Number(fraction.padEnd(6,'0'));
 return Number.isSafeInteger(micros)&&micros>0&&micros<=1000*1000000?micros:null;
}
function bcbTimestamp(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(value))return null;
 const text=value.replace(' ','T').replace(/\.(\d{3})\d+$/,'.$1'),time=Date.parse(text+'-03:00');
 if(!Number.isFinite(time))return null;
 const datePart=new Date(time-3*3600000).toISOString().slice(0,19);
 return datePart===value.slice(0,19).replace(' ','T')?new Date(time).toISOString():null;
}
function ptaxUrl(currency,now){
 if(!CURRENCIES.includes(currency))throw new Error('Moeda não suportada pelo conversor.');
 const day=time=>new Date(time).toLocaleDateString('en-US',{timeZone:'America/Sao_Paulo',month:'2-digit',day:'2-digit',year:'numeric'}).replaceAll('/','-');
 const url=new URL(ROOT+'CotacaoMoedaPeriodoFechamento(codigoMoeda=@codigoMoeda,dataInicialCotacao=@dataInicialCotacao,dataFinalCotacao=@dataFinalCotacao)');
 for(const[key,value]of Object.entries({'@codigoMoeda':`'${currency}'`,'@dataInicialCotacao':`'${day(now-15*DAY)}'`,'@dataFinalCotacao':`'${day(now)}'`,'$format':'json','$orderby':'dataHoraCotacao desc','$top':'20'}))url.searchParams.set(key,value);
 // Olinda does not decode a form-encoded '+' in $orderby as a space.
 return String(url).replace(/\+/g,'%20');
}
function validRate(rate,currency,now){
 const quoted=Date.parse(rate?.quotedAt),fetched=Date.parse(rate?.fetchedAt),expiry=Date.parse(rate?.expiresAt);
 return rate?.source==='bcb_ptax'&&rate.currency===currency&&rate.targetCurrency==='BRL'&&rate.stale!==true&&Number.isSafeInteger(rate.rateMicros)&&rate.rateMicros>0&&rate.rateMicros<=1000000000&&Number.isFinite(quoted)&&quoted<=now&&now-quoted<7*DAY&&Number.isFinite(fetched)&&fetched<=now&&Number.isFinite(expiry)&&expiry>now&&expiry<=quoted+7*DAY;
}
function normalizedRate(body,currency,now,url){
 if(!Array.isArray(body?.value))return null;
 const candidates=body.value.filter(row=>row?.tipoBoletim==='Fechamento').map(row=>({micros:rateMicros(row.cotacaoVenda),quotedAt:bcbTimestamp(row.dataHoraCotacao)})).filter(row=>row.micros!==null&&row.quotedAt&&Date.parse(row.quotedAt)<=now&&now-Date.parse(row.quotedAt)<7*DAY).sort((a,b)=>b.quotedAt.localeCompare(a.quotedAt));
 if(!candidates.length)return null;
 const {micros,quotedAt}=candidates[0];
 return {source:'bcb_ptax',sourceLabel:'Banco Central do Brasil — PTAX venda',currency,targetCurrency:'BRL',rateMicros:micros,rate:micros/1000000,quotedAt,fetchedAt:new Date(now).toISOString(),expiresAt:new Date(Date.parse(quotedAt)+7*DAY).toISOString(),stale:false,sourceUrl:url};
}
function convertInternationalReference(market,item={},rates,now=Date.now()){
 const meta=item.card||item,cardId=item.cardId||meta.providerId||meta.id,setId=item.setId||meta.setId,referenceLanguage=item.referenceLanguage||meta.referenceLanguage||meta.language||item.language,language=item.language||referenceLanguage,variant=item.variant||'NORMAL';
 if((item.kind||'CARD')!=='CARD'||!cardId||!setId||!referenceLanguage||language!==referenceLanguage||!['NORMAL','HOLO','REVERSE'].includes(variant)||item.attributes!=null&&(!Array.isArray(item.attributes)||item.attributes.length))return null;
 const selected=market?.selected!==undefined?market.selected:selectInternationalMarket(market,item,now).selected;
 if(!selected||selected.stale===true||!['cardmarket','tcgplayer'].includes(selected.source)||!CURRENCIES.includes(selected.currency)||selected.source==='cardmarket'&&selected.currency!=='EUR'||selected.source==='tcgplayer'&&selected.currency!=='USD'||selected.cardId!==cardId||selected.setId!==setId||selected.referenceLanguage!==referenceLanguage||selected.variant!==variant||!Number.isSafeInteger(selected.valueCents)||selected.valueCents<=0||selected.valueCents>100000000)return null;
 const quoted=Date.parse(selected.quotedAt);if(!Number.isFinite(quoted)||quoted>now||now-quoted>=7*DAY)return null;
 let source;try{source=new URL(selected.sourceUrl);}catch{return null;}
 if(source.protocol!=='https:'||source.hostname!=='api.tcgdex.net'||source.port||source.username||source.password||source.pathname!==`/v2/${referenceLanguage}/cards/${encodeURIComponent(cardId)}`||source.search||source.hash)return null;
 const rate=rates instanceof Map?rates.get(selected.currency):rates?.[selected.currency];if(!validRate(rate,selected.currency,now))return null;
 const amount=(BigInt(selected.valueCents)*BigInt(rate.rateMicros)+500000n)/1000000n;
 if(amount<=0n||amount>100000000n)return null;
 return {source:'international_fx',sourceLabel:'Referência internacional convertida em reais',market:'international',methodology:'international_reference_converted',currency:'BRL',valueCents:Number(amount),originalCurrency:selected.currency,originalValueCents:selected.valueCents,originalSource:selected.source,originalSourceLabel:selected.sourceLabel,sourceUrl:source.href,exchangeRate:{...rate},quotedAt:selected.quotedAt,fetchedAt:rate.fetchedAt,expiresAt:new Date(Math.min(quoted+7*DAY,Date.parse(rate.expiresAt))).toISOString(),converted:true,fxConverted:true,conditionAdjusted:false,condition:null,marketLanguage:null,providerMappingVerified:false,match:'PARTIAL',usableForBrlValuation:true,cardId,setId,referenceLanguage,language,variant,stale:false};
}
function createFxProvider({db,fetchImpl=globalThis.fetch,now=Date.now,timeoutMs=4500,enabled=true}={}){
 if(!db?.prepare||!db?.transaction)throw new Error('Cache persistente é necessário para o câmbio.');
 const owner=crypto.randomUUID(),flights=new Map(),lock=db.lockSuffix||'';
 const read=async key=>{const row=await db.prepare('SELECT * FROM personal_reference_cache WHERE cache_key=?').get(key);return row?{row,data:parse(row.payload_json)}:null;};
 async function write(key,kind,currency,data,expiry){await db.prepare('INSERT INTO personal_reference_cache(cache_key,kind,language,reference_id,payload_json,fetched_at,expires_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(cache_key) DO UPDATE SET payload_json=excluded.payload_json,fetched_at=excluded.fetched_at,expires_at=excluded.expires_at').run(key,kind,'',currency,JSON.stringify(data),now(),expiry);}
 async function acquire(currency){const key='fx:lease:v1:'+currency;return db.transaction(async()=>{await db.prepare("INSERT INTO personal_reference_cache(cache_key,kind,language,reference_id,payload_json,fetched_at,expires_at) VALUES(?,'fx-lease','',?,'{}',?,?) ON CONFLICT(cache_key) DO NOTHING").run(key,currency,now(),now());const current=await db.prepare('SELECT * FROM personal_reference_cache WHERE cache_key=?'+lock).get(key),state=parse(current.payload_json)||{};if(state.owner&&Number(current.expires_at)>now())return false;await write(key,'fx-lease',currency,{owner},now()+Math.max(10000,timeoutMs+3000));return true;});}
 async function release(currency){const key='fx:lease:v1:'+currency;await db.transaction(async()=>{const current=await db.prepare('SELECT * FROM personal_reference_cache WHERE cache_key=?'+lock).get(key);if(parse(current?.payload_json)?.owner===owner)await write(key,'fx-lease',currency,{},now());});}
 async function request(currency){
  const url=ptaxUrl(currency,now()),controller=new AbortController();let timer;
  const deadline=new Promise((resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('A consulta de câmbio excedeu o tempo disponível.'));},Math.max(1,Math.min(15000,timeoutMs)));});
  try{return await Promise.race([deadline,(async()=>{
   const response=await fetchImpl(url,{method:'GET',headers:{Accept:'application/json'},redirect:'error',signal:controller.signal});
   if(!response.ok){const error=new Error('Câmbio indisponível.');let delay=Number(response.headers?.get?.('retry-after'));if(response.status===429&&Number.isFinite(delay)&&delay>0)error.retryAt=now()+Math.min(delay*1000,DAY);throw error;}
   if(!/application\/(?:[\w.+-]+\+)?json/i.test(response.headers?.get?.('content-type')||'application/json')||Number(response.headers?.get?.('content-length'))>MAX_BYTES)throw new Error('Resposta de câmbio inválida.');
   let raw='';if(response.body?.getReader){const reader=response.body.getReader(),chunks=[];let bytes=0;try{while(true){const next=await reader.read();if(next.done)break;bytes+=next.value.length;if(bytes>MAX_BYTES){await reader.cancel();throw new Error('Resposta de câmbio excede o limite.');}chunks.push(next.value);}raw=Buffer.concat(chunks,bytes).toString('utf8');}finally{reader.releaseLock();}}else raw=typeof response.text==='function'?await response.text():JSON.stringify(await response.json());
   if(Buffer.byteLength(raw)>MAX_BYTES)throw new Error('Resposta de câmbio excede o limite.');
   const rate=normalizedRate(JSON.parse(raw),currency,now(),url);if(!rate)throw new Error('Sem cotação de fechamento atual disponível.');return rate;
  })()]);}finally{clearTimeout(timer);}
 }
 async function rate(currency,allowFetch){
  const key=fxRateKey(currency),cached=await read(key),stored=cached?.data?.rate,usable=validRate(stored,currency,now())?stored:null;
  if(!enabled||!allowFetch||cached&&Number(cached.row.expires_at)>now())return usable;
  if(flights.has(currency))return flights.get(currency);
  const flight=(async()=>{
   if(!await acquire(currency)){
    // A second cold Vercel instance must wait for the request that owns the
    // lease, including a normal network latency above 500 ms. Poll at most
    // every 100/200 ms and bound the entire wait by the HTTP deadline plus a
    // short allowance for the owner's persistent-cache write.
    const deadline=Date.now()+Math.max(1,Math.min(15000,timeoutMs))+500;let delay=100;
    while(Date.now()<deadline){await pause(Math.min(delay,Math.max(1,deadline-Date.now())));const other=await read(key);if(other&&Number(other.row.expires_at)>now())return validRate(other.data?.rate,currency,now())?other.data.rate:null;delay=200;}
    return usable;
   }
   try{const fresh=await read(key);if(fresh&&Number(fresh.row.expires_at)>now())return validRate(fresh.data?.rate,currency,now())?fresh.data.rate:null;
    try{const value=await request(currency);await write(key,'fx-rate',currency,{rate:value},Math.min(now()+TTL,Date.parse(value.expiresAt)));return value;}
    catch(error){await write(key,'fx-rate',currency,{rate:usable,lastError:'UNAVAILABLE',attemptedAt:new Date(now()).toISOString()},Math.max(now()+RETRY,error.retryAt||0));return usable;}
   }finally{await release(currency);}
  })();flights.set(currency,flight);try{return await flight;}finally{flights.delete(currency);}
 }
 async function getRates({allowFetch=true}={}){const values=await Promise.all(CURRENCIES.map(async currency=>[currency,await rate(currency,allowFetch)]));return new Map(values.filter(([,value])=>value));}
 return {getRates,getCachedRates:()=>getRates({allowFetch:false}),id:'bcb_ptax',enabled};
}
module.exports={createFxProvider,convertInternationalReference,rateMicros,bcbTimestamp,ptaxUrl,validRate,fxRateKey};
