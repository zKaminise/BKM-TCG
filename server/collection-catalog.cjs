'use strict';

// Canonical Pokémon metadata. Never writes commercial stock or a customer's
// collection. Shared, bounded provider cache contains no acquisition data.
const crypto = require('node:crypto');
const {AsyncLocalStorage}=require('node:async_hooks');
const {setTimeout:pause}=require('node:timers/promises');
const {normalizeTcgdexMarket}=require('./tcgdex-market.cjs');
const ROOT = 'https://api.tcgdex.net/v2';
const DAY = 86400000;
const MAX_BYTES = 8 * 1024 * 1024;
const LANGUAGES = new Set(['pt','en','ja','fr','de','es','it','ko','zh-tw','zh-cn','id','th']);
const ID = /^[a-zA-Z0-9][a-zA-Z0-9.+_-]{0,179}$/;
const FAMILY_ALIASES = {
  sv:['Escarlate e Violeta','Scarlet & Violet'], swsh:['Espada e Escudo','Sword & Shield'],
  sm:['Sol e Lua','Sun & Moon'], me:['Megaevolução','Mega Evolution'],
  bw:['Preto e Branco','Black & White'], dp:['Diamante e Pérola','Diamond & Pearl'],
  base:['Coleção Básica','Base'], xy:['XY'], ex:['EX'], hgss:['HeartGold SoulSilver']
};
const normalize = value => String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
const compactId = value => normalize(value).replace(/\s/g,'').replace(/\d+/g, digits=>String(Number(digits)));
const normalizedNumber = value => String(value ?? '').trim().toUpperCase().replace(/\d+/g,digits=>digits.replace(/^0+(?=\d)/,''));
const text = (value,max=300) => typeof value==='string'?value.trim().slice(0,max):'';
const integer = value => Number.isSafeInteger(value)&&value>=0?value:null;
const validDate = value => typeof value==='string'&&Number.isFinite(Date.parse(value))?value:null;

function asset(value, size='high') {
  if(typeof value!=='string'||value.length>1200||value.includes('..'))return '';
  try {
    const url=new URL(value);
    if(url.protocol!=='https:'||url.hostname!=='assets.tcgdex.net'||url.username||url.password||url.port||url.search||url.hash||!/^\/[a-zA-Z0-9/._+-]+$/.test(url.pathname)||url.pathname.includes('..'))return '';
    return /\.(?:webp|png|jpg)$/i.test(url.pathname)?url.href:url.href.replace(/\/$/,'')+(size==='logo'?'.webp':`/${size}.webp`);
  } catch {return '';}
}

function parseSearch(value) {
  const original=text(value,160).normalize('NFKC').replace(/\s+/g,' ').trim();
  const unfinished=original.match(/(?:^|\s)([a-zA-Z]{0,8}\d{1,8}[a-zA-Z]{0,4})\s*\/$/);
  if(unfinished)return {original,name:normalize(original.replace(unfinished[0],' ')),number:normalizedNumber(unfinished[1]),printedTotal:null,fullNumber:true,partialNumber:true};
  const code=original.match(/(?:^|\s)([a-zA-Z]{0,8}\d{1,8}[a-zA-Z]{0,4})\s*\/\s*([a-zA-Z]{0,8}\d{1,8}[a-zA-Z]{0,4})(?=$|\s)/);
  if(code)return {original,name:normalize(original.replace(code[0],' ')),number:normalizedNumber(code[1]),printedTotal:normalizedNumber(code[2]),fullNumber:true};
  const number=original.match(/(?:^|\s)([a-zA-Z]{0,5}\d{1,7}[a-zA-Z]{0,3})$/);
  if(number&&!original.includes('-')&&!original.includes(':'))return {original,name:normalize(original.slice(0,number.index)),number:normalizedNumber(number[1]),printedTotal:null,fullNumber:false};
  return {original,name:normalize(original),number:null,printedTotal:null,fullNumber:false};
}

function createCollectionCatalog({db,ApiError,fetchImpl=globalThis.fetch,now=Date.now,timeoutMs=6500}={}) {
  const flights=new Map(),hot=new Map(),budget=new AsyncLocalStorage(),marketFailures=new Map();
  const bounded=fn=>budget.getStore()?fn():budget.run({deadline:Date.now()+40000},fn);
  const fail=(message,code='CATALOG_UNAVAILABLE',status=503)=>{throw new ApiError(status,code,message);};
  function language(value='pt') {
    const result=value==='pt-br'?'pt':value;
    if(!LANGUAGES.has(result))fail('Escolha um idioma de catálogo válido.','VALIDATION',422);
    return result;
  }
  function identity(value,label='carta') {
    if(typeof value!=='string'||!ID.test(value))fail(`Identificador de ${label} inválido.`,'VALIDATION',422);
    return value;
  }
  function pagination(query) {
    return {page:Math.max(1,Math.min(10000,parseInt(query.get('page')||'1',10)||1)),pageSize:Math.max(1,Math.min(24,parseInt(query.get('pageSize')||'18',10)||18))};
  }
  async function readJson(response) {
    if(Number(response.headers?.get?.('content-length'))>MAX_BYTES)throw new Error('payload');
    if(!response.body?.getReader){const raw=typeof response.text==='function'?await response.text():JSON.stringify(await response.json());if(Buffer.byteLength(raw)>MAX_BYTES)throw new Error('payload');return JSON.parse(raw);}
    const reader=response.body.getReader(),chunks=[];let bytes=0;
    try {while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>MAX_BYTES){await reader.cancel();throw new Error('payload');}chunks.push(value);}return JSON.parse(Buffer.concat(chunks,bytes).toString('utf8'));}
    finally {reader.releaseLock();}
  }
  async function cached(kind,lang,id,endpoint,{ttl=DAY,allow404=false}={}) {
    const key=[kind,lang,id].join(':'),memory=hot.get(key);
    if(memory&&memory.expiresAt>now())return memory.value;
    if(flights.has(key))return flights.get(key);
    if(flights.size>=32)fail('Há muitas consultas ao catálogo. Aguarde um instante.','CATALOG_BUSY',429);
    const flight=(async()=>{
      const row=await db.prepare('SELECT * FROM personal_reference_cache WHERE cache_key=?').get(key);
      const saved=row?{data:JSON.parse(row.payload_json),stale:Number(row.expires_at)<=now()||now()-Number(row.fetched_at)>ttl,fetchedAt:new Date(Number(row.fetched_at)).toISOString()}:null;
      if(saved&&!saved.stale)return saved;
      try {
        let response;
        for(let attempt=0;attempt<2;attempt++){
          const remaining=(budget.getStore()?.deadline||Date.now()+40000)-Date.now();
          if(remaining<=0)throw new Error('catalog budget');
          try {
            response=await fetchImpl(`${ROOT}/${lang}/${endpoint}`,{method:'GET',redirect:'error',signal:AbortSignal.timeout(Math.max(1,Math.min(remaining,15000,timeoutMs))),headers:{accept:'application/json','user-agent':'BKM-TCG-Collection/2.0'}});
            if(response.status===429||response.status>=500){await response.body?.cancel?.();throw new Error('transient provider');}
            break;
          }catch(error){if(saved||attempt===1)throw error;await pause(200);}
        }
        if(response.status===404&&!allow404){await response.body?.cancel?.();fail('Esta carta ou coleção não está disponível neste idioma do catálogo. Escolha outra referência; não presumimos uma impressão equivalente.','CATALOG_NOT_FOUND',404);}
        if(response.status!==404&&!response.ok)throw new Error('provider');
        if(response.status===404)await response.body?.cancel?.();
        const data=response.status===404?null:await readJson(response);
        if(data!==null&&(!data||typeof data!=='object'||data.error||data.status>=400))throw new Error('payload');
        const effectiveTtl=data===null?3600000:ttl;
        await db.prepare('INSERT INTO personal_reference_cache(cache_key,kind,language,reference_id,payload_json,fetched_at,expires_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(cache_key) DO UPDATE SET payload_json=excluded.payload_json,fetched_at=excluded.fetched_at,expires_at=excluded.expires_at').run(key,kind,lang,id,JSON.stringify(data),now(),now()+effectiveTtl);
        return {data,stale:false,fetchedAt:new Date(now()).toISOString()};
      } catch(error) {
        if(saved&&saved.data!==null)return {...saved,stale:true};
        if(error.status===404)throw error;
        fail('O catálogo TCGdex está indisponível. Seu acervo salvo foi preservado. Tente novamente.');
      }
    })();
    flights.set(key,flight);
    try {const result=await flight;hot.set(key,{value:result,expiresAt:now()+Math.min(result.stale?15000:60000,ttl)});while(hot.size>64)hot.delete(hot.keys().next().value);return result;}
    finally {flights.delete(key);}
  }
  function setDto(raw,lang) {
    if(!raw||!ID.test(raw.id||'')||!text(raw.name))return null;
    return {id:raw.id,name:text(raw.name),setCode:text(raw.abbreviation?.official||raw.tcgOnline||raw.id,80),language:lang,officialCount:integer(raw.cardCount?.official),totalCards:integer(raw.cardCount?.total),series:text(raw.serie?.name),seriesId:text(raw.serie?.id,80),image:asset(raw.logo||raw.symbol,'logo'),releaseDate:validDate(raw.releaseDate)};
  }
  async function setsIndex(lang) {
    const [sets,series]=await Promise.all([cached('sets',lang,'all','sets'),cached('series',lang,'all','series')]);
    if(!Array.isArray(sets.data)||sets.data.length>5000||!Array.isArray(series.data))fail('O catálogo retornou uma lista de coleções inválida.');
    const pocket=series.data.some(row=>row.id==='tcgp')?await cached('series',lang,'tcgp','series/tcgp'):null;
    const digitalIds=new Set((pocket?.data?.sets||[]).map(row=>row.id));
    const items=sets.data.map(raw=>setDto(raw,lang)).filter(row=>row&&!digitalIds.has(row.id));
    return {items,series:series.data.filter(row=>row&&ID.test(row.id||'')&&row.id!=='tcgp').map(row=>({id:row.id,name:text(row.name)})).sort((a,b)=>b.id.length-a.id.length),digitalIds,stale:sets.stale||series.stale||!!pocket?.stale,fetchedAt:sets.fetchedAt};
  }
  async function setDetail(setId,lang) {
    identity(setId,'coleção');
    const saved=await cached('set',lang,setId,`sets/${encodeURIComponent(setId)}`);
    if(saved.data?.id!==setId||!Array.isArray(saved.data.cards)||saved.data.cards.length>6000)fail('O catálogo retornou uma coleção inválida.');
    if(saved.data.serie?.id==='tcgp')fail('Minha Coleção acompanha itens físicos; cartas digitais de Pokémon TCG Pocket não são incluídas.','CATALOG_DIGITAL_ITEM',422);
    return {...saved,set:setDto(saved.data,lang)};
  }
  function cardDto(raw,set,lang,saved) {
    const variants=raw.variants&&typeof raw.variants==='object'?Object.fromEntries(Object.entries(raw.variants).filter(([key,value])=>/^[a-zA-Z]{1,40}$/.test(key)&&typeof value==='boolean')):{};
    const availableVariants=[];
    for(const [key,value] of Object.entries({normal:'NORMAL',holo:'HOLO',reverse:'REVERSE',wPromo:'PROMO',firstEdition:'FIRST_EDITION'}))if(variants[key]===true)availableVariants.push(value);
    const warnings=[];
    const image=asset(raw.image),small=asset(raw.image,'low');
    if(!image)warnings.push('O catálogo não dispõe de imagem nesta referência.');
    if(saved.stale)warnings.push('Metadados em cache: a fonte está temporariamente indisponível ou aguarda atualização.');
    const number=text(raw.localId||raw.number,40),total=integer(raw.set?.cardCount?.official)??set.officialCount;
    return {id:raw.id,provider:'tcgdex',providerId:raw.id,canonicalId:`tcgdex:${lang}:${raw.id}`,tcg:'pokemon',kind:'CARD',name:text(raw.name)||raw.id,number,localNumber:number,total,printedTotal:total,displayNumber:total===null?number:`${number}/${total}`,setId:set.id,setName:set.name,setCode:set.setCode||set.id,series:set.series||'',seriesId:set.seriesId||'',rarity:text(raw.rarity,120),illustrator:text(raw.illustrator,160),dexNumbers:Array.isArray(raw.dexId)?[...new Set(raw.dexId.filter(value=>Number.isSafeInteger(value)&&value>0))].slice(0,20):[],category:text(raw.category,80),types:Array.isArray(raw.types)?raw.types.filter(value=>typeof value==='string').slice(0,8):[],image,imageSmall:small,imageLarge:image,imageKind:'reference',language:lang,referenceLanguage:lang,availableLanguages:[lang],languageCoverage:'Only the requested provider record is verified; other physical printings are not inferred.',variants,availableVariants,updatedAt:validDate(raw.updated)||saved.fetchedAt,fetchedAt:saved.fetchedAt,metadataStale:saved.stale,warnings,valuation:null,marketData:normalizeTcgdexMarket(raw,{language:lang,fetchedAt:saved.fetchedAt,now:now()})};
  }
  async function card(cardId,setId,lang='pt') {
    lang=language(lang);
    if(typeof cardId==='string'&&cardId.startsWith('tcgdex:')){const parts=cardId.split(':');if(parts.length!==3||parts[1]!==lang)fail('O idioma da referência não corresponde à identidade da carta.','VALIDATION',422);cardId=parts[2];}
    identity(cardId);identity(setId,'coleção');
    const set=await setDetail(setId,lang);
    if(!set.data.cards.some(row=>row.id===cardId))fail('A carta não pertence a esta coleção e idioma de referência.','CARD_NOT_FOUND',404);
    const saved=await cached('card',lang,cardId,`cards/${encodeURIComponent(cardId)}`,{ttl:DAY});
    if(saved.data?.id!==cardId||saved.data.set?.id!==setId||!text(saved.data.name)||!text(saved.data.localId||saved.data.number))fail('Os dados de referência da carta não correspondem à coleção solicitada.','CARD_NOT_FOUND',404);
    return cardDto(saved.data,set.set,lang,{...saved,stale:saved.stale||set.stale});
  }
  async function limitedMap(values,fn,width=4) {
    const output=new Array(values.length);let cursor=0,failure;
    await Promise.all(Array.from({length:Math.min(width,values.length)},async()=>{while(cursor<values.length&&!failure){const index=cursor++;try{output[index]=await fn(values[index],index);}catch(error){failure=error;}}}));
    if(failure)throw failure;
    return output;
  }
  function deriveSetId(brief,setMap) {
    const suffix='-'+String(brief.localId||'');
    const simple=brief.id.endsWith(suffix)?brief.id.slice(0,-suffix.length):'';
    if(setMap.has(simple))return simple;
    return [...setMap.keys()].sort((a,b)=>b.length-a.length).find(id=>brief.id.startsWith(id+'-'))||null;
  }
  async function search(input=new URLSearchParams()) {
    const query=input instanceof URLSearchParams?input:new URLSearchParams(input),{page,pageSize}=pagination(query),parsed=parseSearch(query.get('q')||query.get('name')||query.get('number')||'');
    let lang=language(query.get('language')||'pt');
    const warnings=[];
    const prefix=parsed.original.match(/^tcgdex:([^:]+):(.+)$/);
    if(prefix){lang=language(prefix[1]);parsed.original=prefix[2];parsed.name=normalize(prefix[2]);parsed.number=null;parsed.fullNumber=false;warnings.push(`Identidade canônica: catálogo ${lang}.`);}
    const selectedSet=text(query.get('setId')||query.get('set'),80);
    if(selectedSet)identity(selectedSet,'coleção');
    const index=await setsIndex(lang),setMap=new Map(index.items.map(row=>[row.id,row]));
    if(selectedSet&&!setMap.has(selectedSet))fail('A coleção selecionada não está no catálogo físico deste idioma.','CATALOG_NOT_FOUND',404);
    let aliases=[];
    if(lang!=='en'&&parsed.original){try{const english=await cached('sets','en','all','sets');if(Array.isArray(english.data))aliases=english.data.map(raw=>setDto(raw,'en')).filter(Boolean);}catch{warnings.push('Os aliases internacionais estão temporariamente indisponíveis. A busca neste idioma continua disponível.');}}
    const aliasMap=new Map(aliases.map(row=>[row.id,row]));
    const matchingSets=new Set();
    const tokenized=normalize(parsed.original),tokens=tokenized.split(' ').filter(Boolean),nameTokens=parsed.name.split(' ').filter(Boolean);
    for(const set of index.items){
      const family=index.series.find(row=>set.id.toLowerCase().startsWith(row.id.toLowerCase()));
      const alias=aliasMap.get(set.id),haystack=normalize([set.id,set.name,alias?.name,family?.name,...(FAMILY_ALIASES[family?.id]||[])].join(' '));
      const exactCode=compactId(set.id)===compactId(parsed.original);
      const setNameMatch=tokens.length&&tokens.every(token=>haystack.split(' ').includes(token));
      if(exactCode||setNameMatch)matchingSets.add(set.id);
    }
    // Printed abbreviations are genuine provider metadata, not guessed set IDs.
    // A full expansion alias ending in digits ("Scarlet & Violet 151")
    // means the expansion, while "Charmander 168" means name + local number.
    const expansionSearch=matchingSets.size>0&&!parsed.fullNumber;
    const abbreviation=parsed.number&&parsed.name?parsed.name:parsed.original;
    if(/^[a-zA-Z]{2,8}$/.test(abbreviation)&&!matchingSets.size){
      const params=new URLSearchParams({'abbreviation.official':abbreviation.toUpperCase()});
      const found=await cached('set-query',lang,crypto.createHash('sha256').update(params.toString()).digest('hex').slice(0,32),'sets?'+params.toString());
      if(Array.isArray(found.data))for(const raw of found.data)if(setMap.has(raw.id))matchingSets.add(raw.id);
    }
    if(!parsed.original&&!selectedSet)return {items:[],total:0,page,pageSize,hasMore:false,source:'TCGdex',language:lang,stale:index.stale,fetchedAt:index.fetchedAt,warnings,sets:index.items,series:index.series};
    let briefs,briefCache;
    if(selectedSet){const detail=await setDetail(selectedSet,lang);briefs=detail.data.cards;briefCache=detail;}
    else {briefCache=await cached('cards',lang,'all','cards');briefs=briefCache.data;}
    if(!Array.isArray(briefs)||briefs.length>100000)fail('O catálogo retornou uma lista de cartas inválida.');
    const candidates=[];
    for(const brief of briefs){
      if(!brief||!ID.test(brief.id||'')||!text(brief.name)||!text(brief.localId||brief.number))continue;
      const setId=selectedSet||deriveSetId(brief,setMap),set=setMap.get(setId);if(!set)continue;
      const fullIdentity=brief.id===parsed.original;
      const exactSet=matchingSets.has(setId),localNumber=normalizedNumber(brief.localId||brief.number),live=query.get('live')==='1';
      const numberMatch=parsed.number&&(localNumber===parsed.number||live&&!parsed.fullNumber&&localNumber.startsWith(parsed.number));
      const totalMatch=!parsed.printedTotal||(set.officialCount!==null&&(normalizedNumber(set.officialCount)===parsed.printedTotal||live&&normalizedNumber(set.officialCount).startsWith(parsed.printedTotal)));
      const nameMatch=nameTokens.length&&nameTokens.every(token=>normalize(brief.name).includes(token));
      let match=!parsed.original||fullIdentity;
      if(expansionSearch)match=exactSet;
      else if(parsed.fullNumber)match=numberMatch&&totalMatch&&(!parsed.name||nameMatch||exactSet);
      else if(parsed.number)match=(numberMatch&&(!parsed.name||nameMatch||exactSet))||(!parsed.name&&exactSet);
      else match=match||exactSet||nameMatch;
      if(!match)continue;
      const seriesFilter=query.get('series');
      if(seriesFilter){const family=index.series.find(row=>setId.toLowerCase().startsWith(row.id.toLowerCase()));if(seriesFilter!==family?.id&&!normalize(family?.name).includes(normalize(seriesFilter)))continue;}
      candidates.push({brief,setId,score:fullIdentity?100:exactSet?80:normalize(brief.name)===parsed.name?70:50});
    }
    for(const [inputKey,providerKey]of[['rarity','rarity'],['type','types']])if(text(query.get(inputKey),120)){
      const params=new URLSearchParams({[providerKey]:text(query.get(inputKey),120)}),filtered=await cached('card-query',lang,crypto.createHash('sha256').update(params.toString()).digest('hex').slice(0,32),'cards?'+params.toString());
      if(!Array.isArray(filtered.data))fail('A fonte não pôde aplicar o filtro solicitado.');
      const ids=new Set(filtered.data.map(row=>row.id));for(let i=candidates.length-1;i>=0;i--)if(!ids.has(candidates[i].brief.id))candidates.splice(i,1);
    }
    // Older physical editions sometimes have no Portuguese records. Returning
    // an explicitly English reference is safer than inventing a Portuguese
    // printing or falsely declaring that the real card does not exist.
    if(candidates.length===0&&lang==='pt'&&parsed.original&&!query.has('noLanguageFallback')){
      const fallbackQuery=new URLSearchParams(query);fallbackQuery.set('language','en');fallbackQuery.set('noLanguageFallback','1');
      try {const fallback=await search(fallbackQuery);if(fallback.total>0)return {...fallback,requestedLanguage:'pt',referenceLanguage:'en',languageFallback:true,warnings:[...warnings,'Não há correspondência no catálogo em português. Exibindo referências em inglês, identificadas como tal; isto não comprova uma impressão em português.',...fallback.warnings]};}
      catch(error){if(error.status!==404&&error.status!==503)throw error;}
    }
    candidates.sort((a,b)=>b.score-a.score||a.setId.localeCompare(b.setId,undefined,{numeric:true})||normalizedNumber(a.brief.localId).localeCompare(normalizedNumber(b.brief.localId),undefined,{numeric:true})||a.brief.id.localeCompare(b.brief.id));
    const selected=candidates.slice((page-1)*pageSize,page*pageSize);
    const items=await limitedMap(selected,async({brief,setId})=>card(brief.id,setId,lang));
    const ambiguous=parsed.number&&new Set(candidates.map(value=>value.setId)).size>1;
    if(ambiguous)warnings.push('Esta numeração aparece em mais de uma expansão. Confirme o nome e o código da coleção antes de adicionar.');
    if(index.stale||briefCache.stale||items.some(item=>item.metadataStale))warnings.push('Exibindo os últimos metadados salvos. A consulta externa será tentada novamente posteriormente.');
    return {items,total:candidates.length,page,pageSize,hasMore:page*pageSize<candidates.length,source:'TCGdex',language:lang,stale:index.stale||briefCache.stale||items.some(item=>item.metadataStale),fetchedAt:briefCache.fetchedAt,warnings,ambiguous:!!ambiguous,sets:index.items,series:index.series};
  }
  function safeProductImage(value) {
    if(typeof value!=='string')return '';
    if(/^\/(?:assets|uploads)\/[\w./%-]+$/.test(value)&&!value.includes('..'))return value;
    try {const url=new URL(value);if(url.protocol==='https:'&&!url.username&&!url.password&&!url.port)return url.href;}catch{}
    return '';
  }
  async function sealed(input=new URLSearchParams()) {
    const query=input instanceof URLSearchParams?input:new URLSearchParams(input),{page,pageSize}=pagination(query),q=normalize(text(query.get('q'),160)),id=text(query.get('id'),180);
    if(id)identity(id,'produto selado');
    const params=[],where=["kind='SEALED'",'published=1','archived=0'];
    if(id){where.push('id=?');params.push(id);}
    const rows=await db.prepare('SELECT id,name,set_id,set_name,sku,images_json,attributes_json FROM products WHERE '+where.join(' AND ')+' ORDER BY name,id LIMIT 5000').all(...params);
    const items=rows.map(row=>{let images=[],attributes={};try{images=JSON.parse(row.images_json);attributes=JSON.parse(row.attributes_json);}catch{}const first=images?.[0],image=safeProductImage(typeof first==='string'?first:first?.url),rawCategory=text(attributes.itemType||attributes.category||attributes.productType,60),itemType=['BOOSTER','BLISTER','DECK','ETB','BOX','TIN','ACCESSORY'].includes(rawCategory.toUpperCase())?rawCategory.toUpperCase():null;return {id:row.id,sealedId:row.id,catalogSealedId:row.id,provider:'bkm',providerId:row.id,kind:'SEALED',name:row.name,title:row.name,setId:row.set_id,setName:row.set_name,category:rawCategory||'OTHER_SEALED',itemType,sku:row.sku,image,imageLarge:image,language:null,referenceLanguage:null,valuation:null};}).filter(row=>!q||normalize(row.name+' '+row.setName+' '+row.setId+' '+row.sku).includes(q));
    return {items:items.slice((page-1)*pageSize,page*pageSize),total:items.length,page,pageSize,hasMore:page*pageSize<items.length,source:'Catálogo BKM TCG',warnings:items.length?[]:['Nenhum selado catalogado corresponde à busca. Você pode cadastrar um selado manualmente, sem cotação automática.']};
  }
  async function marketForItems(items,{maxRefresh=8}={}) {
    const references=new Map();
    for(const item of items){
      if(item.kind!=='CARD')continue;
      const lang=item.referenceLanguage||item.card?.referenceLanguage||item.language,cardId=item.cardId||item.card?.providerId,setId=item.setId||item.card?.setId;
      if(!LANGUAGES.has(lang)||!ID.test(cardId||'')||!ID.test(setId||'')||!cardId.startsWith(setId+'-'))continue;
      const key=lang+'|'+cardId;if(!references.has(key))references.set(key,{lang,cardId,setId,snapshot:item.card?.marketData||null});
    }
    const keys=[...references.values()].map(value=>'card:'+value.lang+':'+value.cardId),cachedRows=[];
    for(let offset=0;offset<keys.length;offset+=100){const chunk=keys.slice(offset,offset+100);cachedRows.push(...await db.prepare('SELECT * FROM personal_reference_cache WHERE cache_key IN('+chunk.map(()=>'?').join(',')+')').all(...chunk));}
    const existing=new Map(cachedRows.map(row=>[row.language+'|'+row.reference_id,row])),result=new Map(),due=[];
    for(const[key,item]of references){
      const row=existing.get(key);let raw;
      try{raw=row?JSON.parse(row.payload_json):null;}catch{}
      if(raw?.id===item.cardId&&raw.set?.id===item.setId)result.set(key,normalizeTcgdexMarket(raw,{language:item.lang,fetchedAt:new Date(Number(row.fetched_at)).toISOString(),now:now()}));
      else if(item.snapshot)result.set(key,item.snapshot);
      if((!row||now()-Number(row.fetched_at)>=DAY)&&(!marketFailures.has(key)||marketFailures.get(key)<now())&&due.length<Math.min(24,maxRefresh))due.push([key,item]);
    }
    await limitedMap(due,async([key,item])=>{
      try{const saved=await cached('card',item.lang,item.cardId,'cards/'+encodeURIComponent(item.cardId),{ttl:DAY});if(saved.data?.id!==item.cardId||saved.data.set?.id!==item.setId)throw new Error('identity');result.set(key,normalizeTcgdexMarket(saved.data,{language:item.lang,fetchedAt:saved.fetchedAt,now:now()}));}
      catch{marketFailures.set(key,now()+60000);}
    });
    while(marketFailures.size>200)marketFailures.delete(marketFailures.keys().next().value);
    return result;
  }
  return {search:(...args)=>bounded(()=>search(...args)),card:(...args)=>bounded(()=>card(...args)),sealed,sets:(...args)=>bounded(()=>setsIndex(...args)),marketForItems:(...args)=>bounded(()=>marketForItems(...args)),withBudget:bounded,clearMemoryCache(){hot.clear();}};
}

module.exports={createCollectionCatalog,parseSearch,normalize,normalizedNumber,asset};
