const crypto = require('node:crypto');
// The current wishlist has no explicit attribute criteria. A special-print
// variant must not be advertised as a match for an ordinary copy. Invalid
// metadata also fails closed; migrated legacy variants have an empty array.
function ordinaryWishlistVariant(value){if(value==null)return true;try{const parsed=typeof value==='string'?JSON.parse(value):value;return Array.isArray(parsed)&&parsed.length===0;}catch{return false;}}
const { parsePersonalCsv, exportPersonalCsv } = require('./personal-csv.cjs');
const LANGUAGES = ['pt','en','ja','fr','de','es','it','ko','zh-tw','zh-cn','id','th'];
const CONDITIONS = ['M','NM','SP','LP','MP','HP','D','DMG'];
const VARIANTS = ['NORMAL','HOLO','REVERSE','PROMO','FIRST_EDITION','POKE_BALL','MASTER_BALL','OTHER'];
const defaults = { notifyInApp:true, notifyEmail:false, marketing:false, abandonedCart:false, digest:'immediate', priceAlerts:false, priceTtlDays:7 };
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\b0+(?=\d)/g,'');
const json = value => JSON.parse(value || '{}');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');

function createPersonalCollection({db,ApiError,fetchImpl=globalThis.fetch,mypCardsFetch=globalThis.fetch,env=process.env,priceProvider=null,now=Date.now}) {
  const flights = new Map();
  const canonicalCatalog=require('./collection-catalog.cjs').createCollectionCatalog({db,ApiError,fetchImpl,now});
  const brazilianProvider=require('./mypcards-market.cjs').createMypCardsProvider({db,fetchImpl:mypCardsFetch,env,now});
  async function brazilianForItems(items,{maxRefresh=2}={}){
    const cards=items.filter(item=>!item.kind||item.kind==='CARD'),cached=await brazilianProvider.getCachedReferences(cards),result=new Map(cached);
    if(!brazilianProvider.enabled)return result;
    const seen=new Set(),due=cards.filter(item=>{const meta=item.card||item,ref=item.referenceLanguage||meta.referenceLanguage||meta.language||item.language,physical=item.language||ref,cardId=item.cardId||meta.providerId||meta.id,key=ref+'|'+cardId,quote=cached.get(key);if(!['pt','en'].includes(ref)||physical!==ref||seen.has(key))return false;seen.add(key);return !quote||quote.stale||!quote.expiresAt||Date.parse(quote.expiresAt)<=now();});
    const chosen=due.slice(0,Math.max(0,Math.min(2,maxRefresh))),selected=new Set(chosen);
    // Keep a request's external budget at two identities. Afterwards one
    // shared name response can resolve all other printings without HTTP.
    for(const item of chosen){const meta=item.card||item,ref=item.referenceLanguage||meta.referenceLanguage||meta.language||item.language,quote=await brazilianProvider.getReference(item,{allowFetch:brazilianProvider.enabled,physicalLanguage:item.language||ref});if(quote)result.set(ref+'|'+(item.cardId||meta.providerId||meta.id),quote);}
    for(const item of cards){if(selected.has(item))continue;const meta=item.card||item,ref=item.referenceLanguage||meta.referenceLanguage||meta.language||item.language,key=ref+'|'+(item.cardId||meta.providerId||meta.id),previous=result.get(key);if(!['pt','en'].includes(ref)||item.language&&item.language!==ref)continue;if(previous&&!previous.stale&&Date.parse(previous.expiresAt)>now())continue;const quote=await brazilianProvider.getReference(item,{allowFetch:false,physicalLanguage:item.language||ref});if(quote)result.set(key,quote);}
    return result;
  }
  async function decorateCards(cards,options){const references=await brazilianForItems(cards,options);return cards.map(card=>({...card,brazilianMarket:references.get((card.referenceLanguage||card.language)+'|'+(card.providerId||card.id))||null}));}
  const enhancedCatalog={...canonicalCatalog,brazilianForItems,brazilianEnabled:brazilianProvider.enabled,
    async search(query){const result=await canonicalCatalog.search(query);return {...result,items:await decorateCards(result.items,{maxRefresh:2})};},
    async card(...args){const card=await canonicalCatalog.card(...args);return (await decorateCards([card],{maxRefresh:0}))[0];}
  };
  const inventory=require('./personal-inventory.cjs').createPersonalInventory({db,ApiError,catalog:enhancedCatalog,legacyPrices:priceMap,preferences,now});
  const stamp = () => new Date(now()).toISOString();
  function fail(message, code='VALIDATION', status=422) { throw new ApiError(status,code,message); }
  function identity(value,label,max=100) { if (typeof value!=='string' || !/^[a-zA-Z0-9.+_-]+$/.test(value) || value.length>max) fail(`Informe ${label} válido.`); return value; }
  function language(value='pt') { if (!LANGUAGES.includes(value)) fail('Idioma não suportado pelo catálogo.'); return value; }
  function integer(value,label,min=0,max=100000000) { if (!Number.isSafeInteger(value) || value<min || value>max) fail(`Informe ${label} entre ${min} e ${max}.`); return value; }
  function optionalText(value,max=2000) { if (value==null) return ''; if(typeof value!=='string' || value.length>max) fail(`Texto deve ter até ${max} caracteres.`); return value.trim(); }
  function safeUrl(value) { if(!value)return ''; const text=optionalText(value,2000); if(/^\/(?:assets|uploads)\/[\w./%-]+$/.test(text)&&!text.includes('..'))return text; try {const url=new URL(text);if(url.protocol==='https:'&&!url.username&&!url.password)return url.href;}catch{} fail('Use uma URL HTTPS válida.'); }
  function pageOf(query) { return {page:Math.max(1,Math.min(10000,parseInt(query.get('page') || '1',10)||1)),pageSize:Math.max(1,Math.min(60,parseInt(query.get('pageSize') || '24',10)||24))}; }
  function paginate(items,query) { const {page,pageSize}=pageOf(query);return {items:items.slice((page-1)*pageSize,page*pageSize),total:items.length,page,pageSize}; }
  function requireOwner(user) { if(!user?.id) fail('Entre na sua conta para acessar a coleção pessoal.','AUTH_REQUIRED',401); return user.id; }
  async function owned(table,id,userId) { const row=await db.prepare(`SELECT * FROM ${table} WHERE id=? AND user_id=?`).get(id,userId); if(!row)fail('Registro pessoal não encontrado.','NOT_FOUND',404); return row; }
  async function preferences(userId) { const row=await db.prepare('SELECT preferences_json FROM personal_preferences WHERE user_id=?').get(userId);return {...defaults,...(row?json(row.preferences_json):{}),private:true}; }
  async function savePreferences(userId,data) {
    const previous=await preferences(userId),saved={...previous};
    const emailKeys=['notifyEmail','marketing','abandonedCart','priceAlerts'];
    for(const key of ['notifyInApp',...emailKeys])if(data[key]!==undefined){if(typeof data[key]!=='boolean')fail('Preferências devem ser booleanas.');saved[key]=data[key];}
    if(data.digest!==undefined){if(!['immediate','daily','weekly'].includes(data.digest))fail('Periodicidade de resumo inválida.');saved.digest=data.digest;}
    if(emailKeys.some(key=>Object.prototype.hasOwnProperty.call(data,key)))saved.consent={source:'personal_collection_settings',updatedAt:stamp(),enabled:emailKeys.filter(key=>saved[key])};
    if(data.priceTtlDays!==undefined)saved.priceTtlDays=integer(data.priceTtlDays,'validade do preço em dias',1,365);
    delete saved.private;
    await db.prepare('INSERT INTO personal_preferences(user_id,preferences_json,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET preferences_json=excluded.preferences_json,updated_at=excluded.updated_at').run(userId,JSON.stringify(saved),stamp());return {...saved,private:true};
  }

  async function cached(kind,lang,id,endpoint,ttl) {
    const key=[kind,lang,id].join(':'),row=await db.prepare('SELECT * FROM personal_reference_cache WHERE cache_key=?').get(key);
    if(row && row.expires_at>now())return {data:json(row.payload_json),stale:false,fetchedAt:new Date(Number(row.fetched_at)).toISOString()};
    if(flights.has(key))return flights.get(key);
    const flight=(async()=>{
      try {
        const response=await fetchImpl('https://api.tcgdex.net/v2/'+lang+'/'+endpoint,{signal:AbortSignal.timeout(10000),redirect:'error',headers:{accept:'application/json'}});
        if(!response.ok)throw new Error('TCGdex '+response.status);
        const raw=typeof response.text==='function'?await response.text():JSON.stringify(await response.json());
        if(Buffer.byteLength(raw)>8*1024*1024)throw new Error('TCGdex payload limit');
        const data=JSON.parse(raw);if(!data || typeof data!=='object')throw new Error('Invalid catalogue');
        await db.prepare('INSERT INTO personal_reference_cache(cache_key,kind,language,reference_id,payload_json,fetched_at,expires_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(cache_key) DO UPDATE SET payload_json=excluded.payload_json,fetched_at=excluded.fetched_at,expires_at=excluded.expires_at').run(key,kind,lang,id,JSON.stringify(data),now(),now()+ttl);
        return {data,stale:false,fetchedAt:stamp()};
      } catch(error) { if(row)return {data:json(row.payload_json),stale:true,fetchedAt:new Date(Number(row.fetched_at)).toISOString()};fail('O catálogo TCGdex está indisponível. Tente novamente mais tarde.','CATALOG_UNAVAILABLE',503); }
    })();flights.set(key,flight);try{return await flight;}finally{flights.delete(key);}
  }
  const image = (value,card=false) => typeof value==='string' && value.startsWith('https://assets.tcgdex.net/') ? value + (/\.(?:png|webp|jpg)$/i.test(value)?'':card?'/high.webp':'.webp') : '';
  function cardDto(raw,set,lang) { return {id:raw.id,name:String(raw.name || raw.id),number:String(raw.localId || raw.number || raw.id.slice(set.id.length+1)),image:image(raw.image,true),rarity:String(raw.rarity||''),setId:set.id,setName:set.name,language:lang,tcg:'pokemon',variants:raw.variants && typeof raw.variants==='object'?raw.variants:null,provider:'tcgdex',providerId:raw.id}; }
  async function catalogSets(query) {const lang=language(query.get('language')||'pt'),cache=await cached('sets',lang,'all','sets',24*3600000);if(!Array.isArray(cache.data))fail('Resposta do catálogo inválida.','CATALOG_UNAVAILABLE',503);const q=normalize(query.get('q'));const items=cache.data.filter(row=>row&&typeof row.id==='string'&&typeof row.name==='string').map(row=>({id:row.id,name:row.name,language:lang,image:image(row.logo||row.symbol),series:row.serie?.name||'',totalCards:row.cardCount?.total??null})).filter(row=>!q||normalize(row.id+' '+row.name).includes(q));return {...paginate(items,query),source:'TCGdex',stale:cache.stale,fetchedAt:cache.fetchedAt};}
  async function setReference(setId,lang) { identity(setId,'código da coleção',80);language(lang);const cache=await cached('set',lang,setId,'sets/'+encodeURIComponent(setId),24*3600000);const raw=cache.data;if(raw.id!==setId || !Array.isArray(raw.cards) || raw.cards.length>3000)fail('Checklist da coleção não encontrado.','CATALOG_NOT_FOUND',404);const set={id:raw.id,name:String(raw.name||raw.id),image:image(raw.logo||raw.symbol),series:raw.serie?.name||'',officialCount:Number(raw.cardCount?.official)||null,totalCards:raw.cards.length,language:lang,source:'TCGdex',fetchedAt:cache.fetchedAt,stale:cache.stale};return {...set,cards:raw.cards.filter(card=>card&&typeof card.id==='string').map(card=>cardDto(card,set,lang))};}
  async function cardReference(cardId,setId,lang) {
    if(typeof cardId==='string' && cardId.startsWith('tcgdex:')) { const parts=cardId.split(':');if(parts.length!==3 || parts[1]!==lang)fail('Idioma da identidade da carta não corresponde.');cardId=parts[2]; }
    identity(cardId,'identificador da carta',180);identity(setId,'código da coleção',80);language(lang);
    if(!cardId.startsWith(setId+'-'))fail('A carta não pertence à coleção informada.');
    const set=await setReference(setId,lang);if(!set.cards.some(card=>card.id===cardId))fail('Carta ausente do checklist de referência.','CARD_NOT_FOUND',404);
    const cache=await cached('card',lang,cardId,'cards/'+encodeURIComponent(cardId),7*86400000),raw=cache.data;
    if(raw.id!==cardId || raw.set?.id!==setId)fail('A referência da carta não corresponde à coleção.','CARD_NOT_FOUND',404);
    return {...cardDto(raw,set,lang),metadataStale:cache.stale};
  }
  async function preloadLotReferences(items) {
    const requests=new Map(),references=new Map(),errors=new Map(),details=new Map();
    for(const item of items){const lang=language(item.language||'pt'),setId=identity(item.setId,'código da coleção',80);requests.set(lang+'|'+setId,{lang,setId});}
    if(requests.size>20)fail('Importe até 20 catálogos/idiomas por vez. Divida os demais em outro arquivo.');
    const pending=[...requests.entries()];let index=0;
    await Promise.all(Array.from({length:Math.min(4,pending.length)},async()=>{while(index<pending.length){const [key,{lang,setId}]=pending[index++];try{references.set(key,await setReference(setId,lang));}catch(error){errors.set(key,error);}}}));
    const keys=[...new Set(items.map(item=>'card:'+(item.language||'pt')+':'+String(item.cardId||'').replace(/^tcgdex:[^:]+:/,'')))];
    if(keys.length){const rows=await db.prepare('SELECT language,payload_json FROM personal_reference_cache WHERE cache_key IN ('+keys.map(()=>'?').join(',')+')').all(...keys);for(const row of rows){const card=json(row.payload_json);details.set(row.language+'|'+card.id,card);}}
    return {references,errors,details};
  }
  async function lockOwner(userId) {if(db.engine==='postgres')await db.prepare('SELECT id FROM users WHERE id=? FOR UPDATE').get(userId);}
  function goalOf(data={}) { if(!data || typeof data!=='object' || Array.isArray(data))fail('Objetivo inválido.');const mode=data.mode||'basic';if(!['basic','custom'].includes(mode))fail('Escolha objetivo básico ou personalizado.');const variants=data.variants||[];if(!Array.isArray(variants)||variants.length>6||variants.some(value=>!VARIANTS.includes(value)))fail('Variantes do objetivo inválidas.');return {mode,includeSecrets:mode==='custom'&&data.includeSecrets===true,variants:mode==='custom'?[...new Set(variants)]:[]}; }
  async function addSet(userId,data) {const lang=language(data.language||'pt'),reference=await setReference(data.setId,lang),goal=goalOf(data.goal),prior=await db.prepare('SELECT * FROM personal_collections WHERE user_id=? AND set_id=? AND language=?').get(userId,reference.id,lang);if(prior)return collectionSummary(prior,await allLots(userId),await allWishes(userId),await priceMap(userId),await preferences(userId));const id=crypto.randomUUID();await db.prepare('INSERT INTO personal_collections(id,user_id,set_id,language,goal_json,reference_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(user_id,set_id,language) DO NOTHING').run(id,userId,reference.id,lang,JSON.stringify(goal),JSON.stringify(reference),stamp(),stamp());return collectionSummary(await db.prepare('SELECT * FROM personal_collections WHERE user_id=? AND set_id=? AND language=?').get(userId,reference.id,lang),await allLots(userId),await allWishes(userId),await priceMap(userId),await preferences(userId));}
  async function allLots(userId) { return db.prepare("SELECT * FROM personal_lots WHERE user_id=? AND kind='CARD' AND status IN('IN_COLLECTION','FOR_SALE') ORDER BY updated_at DESC,id LIMIT 10000").all(userId); }
  async function allWishes(userId) {return db.prepare('SELECT * FROM personal_wishlist WHERE user_id=? AND enabled=1 ORDER BY created_at DESC,id LIMIT 2000').all(userId);}
  async function priceMap(userId) {
    const rows=await db.prepare('SELECT * FROM (SELECT personal_prices.*,ROW_NUMBER() OVER(PARTITION BY card_id,language,condition,variant ORDER BY quoted_at DESC,recorded_at DESC,id DESC) AS quote_rank FROM personal_prices WHERE user_id=?) ranked WHERE quote_rank=1').all(userId),map=new Map();
    for(const row of rows)map.set([row.card_id,row.language,row.condition,row.variant].join('|'),row);
    if(priceProvider?.getQuotes){
      const lots=await db.prepare("SELECT card_id,set_id,language,condition,variant FROM personal_lots WHERE user_id=? AND kind='CARD' AND status IN('IN_COLLECTION','FOR_SALE') LIMIT 10000").all(userId),prefs=await preferences(userId);
      const quotes=await priceProvider.getQuotes(lots.map(lot=>({cardId:lot.card_id,setId:lot.set_id,language:lot.language,condition:lot.condition,variant:lot.variant})));
      const wanted=new Set(lots.map(lot=>[lot.card_id,lot.set_id,lot.language,lot.condition,lot.variant].join('|')));
      for(const quote of quotes){
        if(quote.currency!=='BRL'||!Number.isSafeInteger(quote.valueCents)||quote.valueCents<0||!wanted.has([quote.cardId,quote.setId,quote.language,quote.condition,quote.variant].join('|')))continue;
        const key=[quote.cardId,quote.language,quote.condition,quote.variant].join('|'),previous=map.get(key);
        if(previous&&!valuation(previous,prefs).stale)continue;
        if(previous&&quote.stale&&Date.parse(previous.quoted_at)>=Date.parse(quote.quotedAt))continue;
        map.set(key,{id:quote.id,card_id:quote.cardId,set_id:quote.setId,language:quote.language,condition:quote.condition,variant:quote.variant,value_cents:quote.valueCents,source:quote.source,source_label:quote.sourceLabel,source_url:quote.sourceUrl,methodology:quote.methodology,observations:quote.observations??null,quoted_at:quote.quotedAt,recorded_at:quote.recordedAt,coverage:quote.coverage||'authorized_provider',provider_stale:quote.stale===true});
      }
    }
    const identities=await db.prepare("SELECT card_id,set_id,language,reference_language FROM personal_lots WHERE user_id=? AND kind='CARD' LIMIT 10000").all(userId);
    map.brazilian=await brazilianProvider.getCachedReferences(identities.map(row=>({cardId:row.card_id,setId:row.set_id,language:row.language,referenceLanguage:row.reference_language||row.language})));
    return map;
  }
  function valuation(row,prefs) { if(!row)return null;return {id:row.id,cardId:row.card_id,setId:row.set_id,language:row.language,condition:row.condition,variant:row.variant,valueCents:row.value_cents,currency:'BRL',source:row.source,sourceLabel:row.source_label,sourceUrl:row.source_url,methodology:row.methodology,observations:row.observations,quotedAt:row.quoted_at,recordedAt:row.recorded_at,coverage:row.coverage,stale:row.provider_stale===true||now()-Date.parse(row.quoted_at)>prefs.priceTtlDays*86400000,manual:row.methodology==='manual'}; }
  const priceKey = lot => [lot.card_id,lot.language,lot.condition,lot.variant].join('|');
  // One valuation policy for the dashboard, binders, checklist and CSV. In
  // particular, a private per-exemplar override must keep its exact identity,
  // date and priority when navigating to an older collection view.
  function lotDto(row,prices,prefs) {return inventory.describe(row,{map:prices,prefs,brazilian:prices.brazilian||new Map()});}
  function eligibleCards(reference,goal) {return reference.cards.filter(card=>goal.includeSecrets || !reference.officialCount || /^\d+$/.test(card.number)&&Number(card.number)<=reference.officialCount);}
  function progressFor(reference,goal,lots) {const cards=eligibleCards(reference,goal);let ownedCards=0,ownedTargets=0,missingCards=0;for(const card of cards){const owned=lots.filter(lot=>lot.card_id===card.id&&lot.language===reference.language),required=goal.variants.length?goal.variants:['ANY'];const matched=required.filter(variant=>owned.some(lot=>variant==='ANY'||lot.variant===variant)).length;if(owned.length)ownedCards++;if(matched<required.length)missingCards++;ownedTargets+=matched;}const requiredTargets=cards.length*(goal.variants.length||1);return {totalCards:cards.length,ownedCards,missingCards,requiredTargets,ownedTargets,completionPercent:requiredTargets?Math.round(ownedTargets/requiredTargets*10000)/100:0,completed:requiredTargets>0&&ownedTargets===requiredTargets};}
  function valueTotals(lots,prices,prefs) {return require('./personal-inventory.cjs').collectionMetrics(lots.map(lot=>lotDto(lot,prices,prefs)));}
  function collectionSummary(row,lots,wishes,prices,prefs) {const reference=json(row.reference_json),goal=json(row.goal_json),owned=lots.filter(lot=>lot.set_id===row.set_id&&lot.language===row.language);return {id:row.id,setId:row.set_id,name:reference.name,language:row.language,image:reference.image,series:reference.series,goal,...progressFor(reference,goal,owned),...valueTotals(owned,prices,prefs),wantedCards:wishes.filter(wish=>wish.set_id===row.set_id&&wish.reference_language===row.language).length,referenceUpdatedAt:reference.fetchedAt,referenceStale:now()-Date.parse(reference.fetchedAt)>86400000,createdAt:row.created_at,updatedAt:row.updated_at};}
  async function listSets(userId) {const [rows,lots,wishes,prices,prefs]=await Promise.all([db.prepare('SELECT * FROM personal_collections WHERE user_id=? ORDER BY created_at DESC,id').all(userId),allLots(userId),allWishes(userId),priceMap(userId),preferences(userId)]);return {items:rows.map(row=>collectionSummary(row,lots,wishes,prices,prefs))};}
  async function summary(userId) {
    const [sets,lots,prices,prefs]=await Promise.all([listSets(userId),allLots(userId),priceMap(userId),preferences(userId)]),values=valueTotals(lots,prices,prefs);
    const totals={...values,...await inventory.stats(userId),startedSets:sets.items.length,completedSets:sets.items.filter(set=>set.completed).length,missingCards:sets.items.reduce((sum,set)=>sum+set.missingCards,0)};
    const topCards=lots.map(row=>lotDto(row,prices,prefs)).filter(lot=>lot.valuation&&!lot.valuation.stale).sort((a,b)=>b.valuation.valueCents-a.valuation.valueCents).slice(0,6);
    const currentHash=digest(JSON.stringify({totals,sets:sets.items.map(set=>({id:set.id,estimatedValueCents:set.estimatedValueCents,quantity:set.quantity,coveragePercent:set.coveragePercent}))}));
    const previous=await db.prepare('SELECT content_hash FROM personal_value_snapshots WHERE user_id=? ORDER BY observed_at DESC,id DESC LIMIT 1').get(userId);
    if(previous?.content_hash!==currentHash)await db.prepare('INSERT INTO personal_value_snapshots(id,user_id,content_hash,totals_json,sets_json,observed_at) VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(),userId,currentHash,JSON.stringify(totals),JSON.stringify(sets.items.map(set=>({id:set.id,name:set.name,estimatedValueCents:set.estimatedValueCents,quantity:set.quantity,coveragePercent:set.coveragePercent}))),stamp());
    const snapshots=await db.prepare('SELECT * FROM personal_value_snapshots WHERE user_id=? ORDER BY observed_at DESC,id DESC LIMIT 366').all(userId);
    const history=snapshots.reverse().map(row=>({observedAt:row.observed_at,...json(row.totals_json),sets:json(row.sets_json)}));
    return {totals,sets:sets.items,topCards,history,historyMessage:history.length>1?'Snapshots observados nesta conta. Mudanças de quantidade e cobertura também alteram os totais.':'O histórico começa no primeiro registro observado; nenhum preço passado será inventado.',valuationMessage:values.partial?'Estimativa parcial: há cartas sem cotação atual.':'Referências informadas; não representam lucro ou garantia de venda.',priceProviders:{configured:!!priceProvider||brazilianProvider.enabled,automated:priceProvider?.automated===true||brazilianProvider.enabled,manual:true,mypcards:brazilianProvider.enabled,brazilianAggregation:'pt_en_offers',ligapokemon:false}};
  }

  async function validateLot(data,previous,{briefOnly=false,preloaded=null}={}) {
    const merged={...(previous?lotDto(previous,new Map(),defaults):{}),...data},lang=language(merged.language||'pt');
    let card;
    if(briefOnly){
      const key=lang+'|'+merged.setId;
      if(preloaded?.errors.has(key))throw preloaded.errors.get(key);
      const set=preloaded?.references.get(key)||await setReference(merged.setId,lang);
      let cardId=merged.cardId;
      if(typeof cardId==='string'&&cardId.startsWith('tcgdex:')){const parts=cardId.split(':');if(parts.length!==3||parts[1]!==lang)fail('Idioma da identidade da carta não corresponde.');cardId=parts[2];}
      identity(cardId,'identificador da carta',180);card=set.cards.find(card=>card.id===cardId);
      if(!card)fail('Carta ausente do checklist de referência.','CARD_NOT_FOUND',404);
      const detailed=preloaded?preloaded.details.get(lang+'|'+cardId):await db.prepare('SELECT payload_json FROM personal_reference_cache WHERE cache_key=?').get('card:'+lang+':'+cardId);
      if(detailed)card=cardDto(detailed.payload_json?json(detailed.payload_json):detailed,set,lang);
    }else card=await cardReference(merged.cardId,merged.setId,lang);
    const condition=merged.condition||'NM',variant=merged.variant||'NORMAL';if(!CONDITIONS.includes(condition)||!VARIANTS.includes(variant))fail('Condição ou variante inválida.');const acquiredAt=merged.acquiredAt||null;if(acquiredAt && (!/^\d{4}-\d{2}-\d{2}$/.test(acquiredAt)||!Number.isFinite(Date.parse(acquiredAt))||new Date(acquiredAt).toISOString().slice(0,10)!==acquiredAt||acquiredAt>stamp().slice(0,10)))fail('Data de aquisição inválida ou futura.');return {card,setId:card.setId,cardId:card.id,language:lang,condition,variant,quantity:integer(merged.quantity??1,'quantidade',1,9999),paidCents:merged.paidCents==null||merged.paidCents===''?null:integer(merged.paidCents,'custo unitário em centavos'),acquiredAt,notes:optionalText(merged.notes),photoUrl:safeUrl(merged.photoUrl)};}
  async function writeNewLots(userId,validated) {
    const time=stamp(),columns=['id','user_id','set_id','card_id','language','condition','variant','quantity','paid_cents','acquired_at','notes','photo_url','metadata_json','search_text','created_at','updated_at'];
    const rows=validated.map(data=>({id:crypto.randomUUID(),user_id:userId,set_id:data.setId,card_id:data.cardId,language:data.language,condition:data.condition,variant:data.variant,quantity:data.quantity,paid_cents:data.paidCents,acquired_at:data.acquiredAt,notes:data.notes,photo_url:data.photoUrl,metadata_json:JSON.stringify(data.card),search_text:normalize(data.card.name+' '+data.card.number),created_at:time,updated_at:time}));
    for(let offset=0;offset<rows.length;offset+=50){const chunk=rows.slice(offset,offset+50),sql='INSERT INTO personal_lots('+columns.join(',')+') VALUES '+chunk.map(()=> '('+columns.map(()=>'?').join(',')+')').join(',');await db.prepare(sql).run(...chunk.flatMap(row=>columns.map(column=>row[column])));}
    return rows;
  }
  async function writeLot(userId,data,previous) {const id=previous?.id||crypto.randomUUID(),time=stamp();if(previous)await db.prepare('UPDATE personal_lots SET set_id=?,card_id=?,language=?,condition=?,variant=?,quantity=?,paid_cents=?,acquired_at=?,notes=?,photo_url=?,metadata_json=?,search_text=?,updated_at=? WHERE id=? AND user_id=?').run(data.setId,data.cardId,data.language,data.condition,data.variant,data.quantity,data.paidCents,data.acquiredAt,data.notes,data.photoUrl,JSON.stringify(data.card),normalize(data.card.name+' '+data.card.number),time,id,userId);else await db.prepare('INSERT INTO personal_lots(id,user_id,set_id,card_id,language,condition,variant,quantity,paid_cents,acquired_at,notes,photo_url,metadata_json,search_text,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,userId,data.setId,data.cardId,data.language,data.condition,data.variant,data.quantity,data.paidCents,data.acquiredAt,data.notes,data.photoUrl,JSON.stringify(data.card),normalize(data.card.name+' '+data.card.number),time,time);return id;}
  async function saveLot(userId,data,id) {if(id)return (await inventory.edit(userId,id,data)).item;const valid=await validateLot(data,null);await db.transaction(async()=>{await lockOwner(userId);if((await db.prepare('SELECT COUNT(*) count FROM personal_lots WHERE user_id=?').get(userId)).count>=10000)fail('Limite de 10.000 lotes pessoais atingido.');id=await writeLot(userId,valid,null);});return lotDto(await owned('personal_lots',id,userId),await priceMap(userId),await preferences(userId));}
  async function batchLots(userId,data) {if(!Array.isArray(data.items)||!data.items.length||data.items.length>200)fail('Selecione entre 1 e 200 cartas por lote.');const validated=[],preloaded=await preloadLotReferences(data.items);for(const item of data.items)validated.push(await validateLot(item,null,{briefOnly:true,preloaded}));const saved=await db.transaction(async()=>{await lockOwner(userId);if((await db.prepare('SELECT COUNT(*) count FROM personal_lots WHERE user_id=?').get(userId)).count+validated.length>10000)fail('Limite de 10.000 lotes pessoais atingido.');return writeNewLots(userId,validated);});const [prices,prefs]=await Promise.all([priceMap(userId),preferences(userId)]);return {items:saved.map(row=>lotDto(row,prices,prefs))};}
  async function listLots(userId,query) {
    const where=["user_id=?","kind='CARD'","status IN('IN_COLLECTION','FOR_SALE')"],args=[userId],{page,pageSize}=pageOf(query);
    for(const [parameter,column]of[['setId','set_id'],['language','language'],['condition','condition'],['variant','variant'],['cardId','card_id']])if(query.get(parameter)){where.push(column+'=?');args.push(query.get(parameter));}
    for(const word of normalize(query.get('q')).split(/\s+/).filter(Boolean).slice(0,8)){where.push("search_text LIKE ? ESCAPE '\\'");args.push('%'+word.replace(/[\\%_]/g,'\\$&')+'%');}
    const sql=where.join(' AND '),total=(await db.prepare('SELECT COUNT(*) count FROM personal_lots WHERE '+sql).get(...args)).count;
    const rows=await db.prepare('SELECT * FROM personal_lots WHERE '+sql+' ORDER BY updated_at DESC,id LIMIT ? OFFSET ?').all(...args,pageSize,(page-1)*pageSize);
    const [prices,prefs]=await Promise.all([priceMap(userId),preferences(userId)]);
    return {items:rows.map(row=>lotDto(row,prices,prefs)),total,page,pageSize};
  }

  async function commercialOffers(setId) {return db.prepare("SELECT p.id,p.slug,p.name,p.images_json,p.set_id,p.tcg,cm.metadata_json AS commercial_card_json,v.id AS variant_id,v.language,v.condition,v.finish,v.price_cents,COALESCE(vm.attributes_json,'[]') variant_attributes_json,v.stock-COALESCE((SELECT SUM(r.quantity) FROM inventory_reservations r WHERE r.variant_id=v.id AND r.status='ACTIVE' AND r.expires_at>?),0) AS available FROM products p JOIN card_metadata cm ON cm.id=p.card_id JOIN variants v ON v.product_id=p.id LEFT JOIN variant_metadata vm ON vm.variant_id=v.id WHERE p.set_id=? AND p.kind='SINGLE' AND p.published=1 AND p.archived=0 AND v.active=1 AND v.stock>0").all(now(),setId);}
  async function offersFor(card,prefs={},preloaded=null) {const rows=preloaded||await commercialOffers(card.setId);return rows.filter(row=>{const meta=json(row.commercial_card_json);return ordinaryWishlistVariant(row.variant_attributes_json)&&normalize(row.tcg)==='pokemon'&&(meta.providerId===card.id || normalize(meta.number)===normalize(card.number))&&row.available>0&&(!prefs.languages?.length||prefs.flexible||prefs.languages.includes(row.language))&&(!prefs.conditions?.length||prefs.flexible||prefs.conditions.includes(row.condition))&&(!prefs.variants?.length||prefs.flexible||prefs.variants.includes(row.finish))&&(prefs.maxPriceCents==null||row.price_cents<=prefs.maxPriceCents);}).map(row=>({id:row.id,productId:row.id,slug:row.slug,name:row.name,variantId:row.variant_id,language:row.language,condition:row.condition,variant:row.finish,attributes:[],priceCents:row.price_cents,stock:row.available,image:json(row.images_json)?.[0]?.url||'',url:'/produto/'+row.slug}));}
  function wishPreferences(data={},lang='pt') {const result={languages:data.languages||[lang],conditions:data.conditions||['NM'],variants:data.variants||[],maxPriceCents:data.maxPriceCents==null?null:integer(data.maxPriceCents,'preço máximo em centavos'),notifyInApp:data.notifyInApp!==false,notifyEmail:data.notifyEmail===true,flexible:data.flexible===true};for(const [key,allowed]of[['languages',LANGUAGES],['conditions',CONDITIONS],['variants',VARIANTS]])if(!Array.isArray(result[key])||result[key].length>20||result[key].some(value=>!allowed.includes(value)))fail('Preferências de idioma, condição ou variante inválidas.');return result;}
  async function wishDto(row,commercial=null) {const card=json(row.metadata_json),prefs=wishPreferences(json(row.preferences_json),row.reference_language);return {id:row.id,cardId:row.card_id,setId:row.set_id,language:row.reference_language,card,preferences:prefs,offers:await offersFor(card,prefs,commercial),createdAt:row.created_at,updatedAt:row.updated_at};}
  async function saveWish(userId,data,id) {const previous=id?await owned('personal_wishlist',id,userId):null,lang=language(data.language||previous?.reference_language||'pt'),card=await cardReference(data.cardId||previous?.card_id,data.setId||previous?.set_id,lang),prefs=wishPreferences({...json(previous?.preferences_json),...data.preferences},lang),existing=previous||await db.prepare('SELECT * FROM personal_wishlist WHERE user_id=? AND card_id=? AND reference_language=?').get(userId,card.id,lang);if(previous&&(previous.card_id!==card.id||previous.set_id!==card.setId||previous.reference_language!==lang))fail('A identidade de um desejo existente não pode ser alterada.');if(existing){const internal=json(existing.preferences_json)._availability;if(internal&&typeof internal==='object')prefs._availability=internal;}if(!existing&&(await db.prepare('SELECT COUNT(*) count FROM personal_wishlist WHERE user_id=? AND enabled=1').get(userId)).count>=2000)fail('Limite de 2.000 desejos atingido.');const key=existing?.id||crypto.randomUUID();if(existing)await db.prepare('UPDATE personal_wishlist SET preferences_json=?,metadata_json=?,enabled=1,updated_at=? WHERE id=? AND user_id=?').run(JSON.stringify(prefs),JSON.stringify(card),stamp(),key,userId);else await db.prepare('INSERT INTO personal_wishlist(id,user_id,set_id,card_id,reference_language,preferences_json,metadata_json,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,1,?,?)').run(key,userId,card.setId,card.id,lang,JSON.stringify(prefs),JSON.stringify(card),stamp(),stamp());const saved=await owned('personal_wishlist',key,userId),result=await wishDto(saved);await notifyWish(userId,saved,result.offers);return result;}
  async function wishlist(userId,query) {
    const {page,pageSize}=pageOf(query),where=['user_id=?','enabled=1'],args=[userId];
    if(query.get('setId')){where.push('set_id=?');args.push(query.get('setId'));}
    if(query.get('language')){where.push('reference_language=?');args.push(query.get('language'));}
    const sql=where.join(' AND '),total=(await db.prepare('SELECT COUNT(*) count FROM personal_wishlist WHERE '+sql).get(...args)).count;
    const rows=await db.prepare('SELECT * FROM personal_wishlist WHERE '+sql+' ORDER BY created_at DESC,id LIMIT ? OFFSET ?').all(...args,pageSize,(page-1)*pageSize),sets=new Map();
    for(const setId of new Set(rows.map(row=>row.set_id)))sets.set(setId,await commercialOffers(setId));
    return {items:await Promise.all(rows.map(row=>wishDto(row,sets.get(row.set_id)))),total,page,pageSize};
  }
  async function notifyWish(userId,wish,offers,eventKey='',preloadedPreferences=null,productId=null) {
    const prefs=preloadedPreferences||await preferences(userId);
    return db.transaction(async()=>{
      const fresh=await db.prepare('SELECT * FROM personal_wishlist WHERE id=? AND user_id=?'+db.lockSuffix).get(wish.id,userId);
      if(!fresh||!fresh.enabled)return [];
      const specific=json(fresh.preferences_json),state=specific._availability&&typeof specific._availability==='object'?specific._availability:{},eligible=offers.filter(offer=>(!specific.languages?.length||specific.flexible||specific.languages.includes(offer.language))&&(!specific.conditions?.length||specific.flexible||specific.conditions.includes(offer.condition))&&(!specific.variants?.length||specific.flexible||specific.variants.includes(offer.variant))&&(specific.maxPriceCents==null||offer.priceCents<=specific.maxPriceCents)),available=new Map(eligible.map(offer=>[offer.variantId,offer])),transitions=[];
      let changed=false;
      for(const [variantId,previous]of Object.entries(state))if((!productId||previous.productId===productId)&&previous.available&&!available.has(variantId)){state[variantId]={...previous,available:false,changedAt:stamp()};changed=true;}
      for(const offer of eligible){
        const previous=state[offer.variantId];
        if(!previous?.available){
          const generation=(Number(previous?.generation)||0)+1;
          state[offer.variantId]={productId:offer.id,available:true,generation,changedAt:stamp()};changed=true;transitions.push(offer);
          if(prefs.notifyInApp&&specific.notifyInApp!==false){
            const key='wishlist:'+fresh.id+':'+offer.variantId+':availability:'+generation;
            await db.prepare("INSERT INTO personal_notifications(id,user_id,event_key,kind,payload_json,created_at) VALUES(?,?,?,'WISHLIST_AVAILABLE',?,?) ON CONFLICT(user_id,event_key) DO NOTHING").run(crypto.randomUUID(),userId,key,JSON.stringify({title:'Uma carta que você procura está disponível na BKM TCG.',card:json(fresh.metadata_json),offer,generation,eventKey,message:'Disponibilidade sujeita a alterações. Este alerta não reserva estoque.'}),stamp());
          }
        }
      }
      if(changed){specific._availability=state;await db.prepare('UPDATE personal_wishlist SET preferences_json=? WHERE id=? AND user_id=?').run(JSON.stringify(specific),fresh.id,userId);}
      return transitions;
    });
  }
  async function syncWishlist(userId) {const wishes=await allWishes(userId),sets=new Map(),prefs=await preferences(userId);for(const setId of new Set(wishes.map(wish=>wish.set_id)))sets.set(setId,await commercialOffers(setId));for(const wish of wishes)await notifyWish(userId,wish,await offersFor(json(wish.metadata_json),json(wish.preferences_json),sets.get(wish.set_id)),'',prefs);}
  async function eligibleWishlistRecipients(productId) {const product=await db.prepare("SELECT p.set_id FROM products p WHERE p.id=? AND p.kind='SINGLE' AND p.published=1 AND p.archived=0").get(productId);if(!product)return [];const rows=await db.prepare('SELECT w.*,u.email,u.name FROM personal_wishlist w JOIN users u ON u.id=w.user_id WHERE w.set_id=? AND w.enabled=1').all(product.set_id),recipients=new Map(),commercial=await commercialOffers(product.set_id),userPrefs=new Map();for(const wish of rows){if(!userPrefs.has(wish.user_id))userPrefs.set(wish.user_id,await preferences(wish.user_id));const prefs=userPrefs.get(wish.user_id),specific=json(wish.preferences_json);if(!prefs.notifyEmail||!specific.notifyEmail)continue;const offers=(await offersFor(json(wish.metadata_json),specific,commercial)).filter(offer=>offer.id===productId);if(!offers.length)continue;const recipient=recipients.get(wish.user_id)||{userId:wish.user_id,email:wish.email,name:wish.name,items:[],wishlistIds:[]};recipient.items.push(...offers);recipient.wishlistIds.push(wish.id);recipients.set(wish.user_id,recipient);}return [...recipients.values()];}
  async function onInventoryChange(productId,eventKey='') {
    const product=await db.prepare('SELECT set_id FROM products WHERE id=?').get(productId);if(!product)return [];
    const rows=await db.prepare('SELECT * FROM personal_wishlist WHERE set_id=? AND enabled=1').all(product.set_id),commercial=await commercialOffers(product.set_id),userPrefs=new Map(),transitions=new Map();
    for(const wish of rows){
      if(!userPrefs.has(wish.user_id))userPrefs.set(wish.user_id,await preferences(wish.user_id));
      const offers=(await offersFor(json(wish.metadata_json),json(wish.preferences_json),commercial)).filter(offer=>offer.id===productId),arrived=await notifyWish(wish.user_id,wish,offers,eventKey,userPrefs.get(wish.user_id),productId);
      if(arrived.length){const values=transitions.get(wish.user_id)||{variants:new Set(),wishes:new Set()};arrived.forEach(offer=>values.variants.add(offer.variantId));values.wishes.add(wish.id);transitions.set(wish.user_id,values);}
    }
    if(!transitions.size)return [];
    const recipients=await eligibleWishlistRecipients(productId);
    return recipients.filter(recipient=>transitions.has(recipient.userId)).map(recipient=>{const match=transitions.get(recipient.userId);return {...recipient,items:recipient.items.filter(item=>match.variants.has(item.variantId)),wishlistIds:recipient.wishlistIds.filter(id=>match.wishes.has(id))};}).filter(recipient=>recipient.items.length);
  }


  async function checklist(userId,id,query) {let row=await owned('personal_collections',id,userId);const [lots,wishes,prices,prefs]=await Promise.all([allLots(userId),allWishes(userId),priceMap(userId),preferences(userId)]);let reference=json(row.reference_json);try{reference=await setReference(row.set_id,row.language);await db.prepare('UPDATE personal_collections SET reference_json=? WHERE id=? AND user_id=?').run(JSON.stringify(reference),id,userId);row={...row,reference_json:JSON.stringify(reference)};}catch{}const goal=json(row.goal_json),q=normalize(query.get('q')),filter=query.get('state')||'all';const brief=eligibleCards(reference,goal),items=[],commercial=await commercialOffers(row.set_id);const cachedRows=brief.length?await db.prepare('SELECT payload_json FROM personal_reference_cache WHERE cache_key IN ('+brief.map(()=>'?').join(',')+')').all(...brief.map(card=>'card:'+row.language+':'+card.id)):[];const cachedDetails=new Map(cachedRows.map(row=>{const raw=json(row.payload_json);return [raw.id,raw];}));for(const card of brief){const cardLots=lots.filter(lot=>lot.card_id===card.id&&lot.language===row.language),wish=wishes.find(wish=>wish.card_id===card.id&&wish.reference_language===row.language),cachedCard=cachedDetails.get(card.id),detailed=cachedCard?cardDto(cachedCard,reference,row.language):card,quotes=cardLots.map(lot=>lotDto(lot,prices,prefs).valuation).filter(Boolean),quote=quotes.find(quote=>!quote.stale)||quotes[0]||(!cardLots.length?valuation(prices.get([card.id,row.language,'NM',query.get('variant')||goal.variants[0]||'NORMAL'].join('|')),prefs):null);const brazilianMarket=require('./mypcards-market.cjs').selectMypReference(prices.brazilian?.get(row.language+'|'+card.id)||null,{cardId:card.id,setId:row.set_id,referenceLanguage:row.language,language:row.language,variant:query.get('variant')||goal.variants[0]||'NORMAL',attributes:[],card:detailed},now()),effectiveQuote=quote||brazilianMarket?.usableForBrlValuation&&{...brazilianMarket,valueCents:brazilianMarket.avgPriceCents,methodology:'advertised_weighted_mean',aggregate:true,manual:false,conditionAdjusted:false,match:'PRINTING_EXACT'}||null;const offers=await offersFor(detailed,wish?json(wish.preferences_json):{},commercial),ownedQuantity=cardLots.reduce((sum,lot)=>sum+lot.quantity,0),missingVariants=goal.variants.filter(variant=>!cardLots.some(lot=>lot.variant===variant));const missing=goal.variants.length?missingVariants.length>0:!ownedQuantity;if(q&&!normalize(detailed.name+' '+detailed.number).includes(q)||query.get('rarity')&&detailed.rarity!==query.get('rarity')||query.get('language')&&query.get('language')!==row.language||query.get('variant')&&!cardLots.some(lot=>lot.variant===query.get('variant'))||filter==='owned'&&!ownedQuantity||filter==='missing'&&!missing||filter==='wanted'&&!wish||filter==='available'&&!offers.length||filter==='unpriced'&&effectiveQuote&&!effectiveQuote.stale)continue;items.push({...detailed,ownedQuantity,owned:ownedQuantity>0,missing,missingVariants,wanted:!!wish,wishlistId:wish?.id||null,valuation:effectiveQuote,brazilianMarket,offers,addedAt:cardLots[0]?.created_at||null});}const sort=({price_asc:'valueAsc',price_desc:'valueDesc',added:'date'})[query.get('sort')]||query.get('sort')||'number';items.sort((a,b)=>sort==='name'?a.name.localeCompare(b.name):sort==='valueAsc'?(a.valuation?.valueCents??Infinity)-(b.valuation?.valueCents??Infinity):sort==='valueDesc'?(b.valuation?.valueCents??-1)-(a.valuation?.valueCents??-1):sort==='rarity'?a.rarity.localeCompare(b.rarity):sort==='date'?String(b.addedAt||'').localeCompare(a.addedAt||''):a.number.localeCompare(b.number,undefined,{numeric:true}));return {collection:collectionSummary(row,lots,wishes,prices,prefs),...paginate(items,query),metadataCoverage:{detailedCards:items.filter(card=>card.rarity).length,totalCards:items.length},facets:{rarities:[...new Set(items.map(card=>card.rarity).filter(Boolean))],variants:VARIANTS},source:'TCGdex',stale:reference.stale||false};}

  async function recordPrice(userId,data,{authorized=false}={}) {const lang=language(data.language||'pt'),card=await cardReference(data.cardId,data.setId,lang),condition=data.condition||'NM',variant=data.variant||'NORMAL';if(!CONDITIONS.includes(condition)||!VARIANTS.includes(variant))fail('Condição ou variante inválida.');if(data.currency && data.currency!=='BRL')fail('A avaliação aceita apenas referências em BRL, sem conversão presumida.');const quotedAt=data.quotedAt?new Date(data.quotedAt):new Date(now());if(!Number.isFinite(quotedAt.getTime())||quotedAt.getTime()>now()+60000)fail('Data da cotação inválida ou futura.');const id=crypto.randomUUID(),source=authorized?optionalText(data.source,80):'user_manual',sourceLabel=authorized?optionalText(data.sourceLabel,200):optionalText(data.sourceLabel||'Valor informado pelo usuário',200),methodology=authorized?optionalText(data.methodology,100):'manual';if(!source||!sourceLabel||!methodology)fail('Informe fonte e metodologia da cotação.');await db.prepare('INSERT INTO personal_prices(id,user_id,set_id,card_id,language,condition,variant,value_cents,currency,source,source_label,source_url,methodology,observations,quoted_at,recorded_at,coverage) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,userId,card.setId,card.id,lang,condition,variant,integer(data.valueCents,'valor em centavos'),'BRL',source,sourceLabel,safeUrl(data.sourceUrl),methodology,authorized&&data.observations!=null?integer(data.observations,'observações',1,100000):null,quotedAt.toISOString(),stamp(),authorized?(data.source==='admin_manual'?'manual_authorized':'authorized_provider'):'user_reported');return valuation(await owned('personal_prices',id,userId),await preferences(userId));}
  async function priceHistory(userId,query) {
    const where=['user_id=?'],args=[userId],{page,pageSize}=pageOf(query);
    for(const [parameter,column]of[['cardId','card_id'],['setId','set_id'],['language','language'],['condition','condition'],['variant','variant']])if(query.get(parameter)){where.push(column+'=?');args.push(query.get(parameter));}
    const sql=where.join(' AND '),total=(await db.prepare('SELECT COUNT(*) count FROM personal_prices WHERE '+sql).get(...args)).count;
    const rows=await db.prepare('SELECT * FROM personal_prices WHERE '+sql+' ORDER BY quoted_at DESC,recorded_at DESC,id LIMIT ? OFFSET ?').all(...args,pageSize,(page-1)*pageSize),prefs=await preferences(userId);
    return {items:rows.map(row=>valuation(row,prefs)),total,page,pageSize,message:total?'Histórico de referências registradas, sem reconstrução de preços anteriores.':'Preço de mercado indisponível. Registre uma referência manual ou configure um provedor autorizado.'};
  }
  async function refreshPrice(userId,data) {if(!priceProvider?.getQuote)fail('Nenhum provedor autorizado de preços BRL está configurado. Use referência manual.','PRICE_PROVIDER_UNAVAILABLE',503);const lang=language(data.language||'pt'),card=await cardReference(data.cardId,data.setId,lang),condition=data.condition||'NM',variant=data.variant||'NORMAL';const quote=await priceProvider.getQuote({card,language:lang,condition,variant,currency:'BRL'});if(!quote)fail('Preço de mercado indisponível.','PRICE_UNAVAILABLE',404);if(quote.stale)fail('A referência disponível está desatualizada. Aguarde uma atualização da fonte.','PRICE_STALE',409);if(quote.currency!=='BRL'||quote.language&&quote.language!==lang||quote.condition&&quote.condition!==condition||quote.variant&&quote.variant!==variant||quote.cardId&&quote.cardId!==card.id)fail('A cotação não corresponde à carta ou à moeda solicitada.','PRICE_IDENTITY_MISMATCH',502);return recordPrice(userId,{...quote,cardId:card.id,setId:card.setId,language:lang,condition,variant},{authorized:true});}

  async function importPreview(userId,data) {const parsed=parsePersonalCsv(data.csv),rows=[],errors=[...parsed.errors],preloaded=await preloadLotReferences(parsed.rows);for(const row of parsed.rows){try{const valid=await validateLot(row,null,{briefOnly:true,preloaded});rows.push({...valid,line:row.line});}catch(error){errors.push({line:row.line,message:error.status?error.message:'Não foi possível conferir a carta.'});}}const token=crypto.randomBytes(32).toString('base64url'),id=crypto.randomUUID(),expires=now()+30*60000;await db.prepare('DELETE FROM personal_imports WHERE user_id=? AND expires_at<?').run(userId,now());if((await db.prepare("SELECT COUNT(*) count FROM personal_imports WHERE user_id=? AND status='PENDING'").get(userId)).count>=5)fail('Há cinco prévias pendentes. Aguarde a expiração antes de criar outra.');await db.prepare("INSERT INTO personal_imports(id,user_id,token_hash,rows_json,errors_json,expires_at,status,created_at) VALUES(?,?,?,?,?,?,'PENDING',?)").run(id,userId,digest(token),JSON.stringify(rows),JSON.stringify(errors),expires,stamp());return {token,rows,errors,duplicates:parsed.duplicates,expiresAt:new Date(expires).toISOString(),canConfirm:rows.length>0&&errors.length===0,paidCentsUnit:'unitary_brl_cents'};}
  async function importConfirm(userId,data) {
    if(typeof data.token!=='string'||data.token.length>100)fail('Token de importação inválido.');
    return db.transaction(async()=>{
      const row=await db.prepare('SELECT * FROM personal_imports WHERE token_hash=? AND user_id=?'+db.lockSuffix).get(digest(data.token),userId);
      if(!row)fail('Prévia de importação não encontrada.','NOT_FOUND',404);
      if(row.status==='CONFIRMED')return json(row.result_json);
      if(row.expires_at<now())fail('Prévia expirada. Importe novamente.','IMPORT_EXPIRED',410);
      const incoming=json(row.rows_json);if(json(row.errors_json).length)fail('Corrija todas as linhas inválidas antes de confirmar.');
      await lockOwner(userId);
      const existing=await allLots(userId),consolidate=data.consolidate===true,newRows=[],updates=new Map(),matchedIds=[];
      const comparable=value=>JSON.stringify([value.cardId,value.language,value.condition,value.variant,value.paidCents,value.acquiredAt||null,value.notes||'',value.photoUrl||'']);
      const index=new Map(consolidate?existing.filter(lot=>lot.revision===1&&!lot.title&&lot.manual_value_cents==null&&lot.attributes_json==='[]').map(lot=>[comparable({cardId:lot.card_id,language:lot.language,condition:lot.condition,variant:lot.variant,paidCents:lot.paid_cents,acquiredAt:lot.acquired_at,notes:lot.notes,photoUrl:lot.photo_url}),{existing:lot}]):[]);
      for(const source of incoming){
        const value={...source},key=comparable(value),prior=consolidate?index.get(key):null;
        if(prior?.existing){const lot=prior.existing;lot.quantity=integer(lot.quantity+value.quantity,'quantidade consolidada',1,9999);updates.set(lot.id,lot.quantity);matchedIds.push(lot.id);}
        else if(prior?.pending)prior.pending.quantity=integer(prior.pending.quantity+value.quantity,'quantidade consolidada',1,9999);
        else {newRows.push(value);if(consolidate)index.set(key,{pending:value});}
      }
      if(existing.length+newRows.length>10000)fail('Limite de lotes pessoais atingido.');
      for(let offset=0;offset<updates.size;offset+=50){
        const chunk=[...updates.entries()].slice(offset,offset+50),cases=chunk.map(()=> 'WHEN ? THEN ?').join(' '),sql='UPDATE personal_lots SET quantity=CASE id '+cases+' ELSE quantity END,revision=revision+1,updated_at=? WHERE user_id=? AND id IN ('+chunk.map(()=>'?').join(',')+')';
        await db.prepare(sql).run(...chunk.flat(),stamp(),userId,...chunk.map(([id])=>id));
      }
      const saved=await writeNewLots(userId,newRows),result={imported:incoming.length,lotIds:[...new Set([...matchedIds,...saved.map(lot=>lot.id)])],consolidated:consolidate};
      await db.prepare("UPDATE personal_imports SET status='CONFIRMED',result_json=? WHERE id=? AND user_id=?").run(JSON.stringify(result),row.id,userId);
      return result;
    });
  }
  async function exportCollection(userId) {const [lots,prices,prefs]=await Promise.all([allLots(userId),priceMap(userId),preferences(userId)]);const rows=lots.map(lot=>{const quote=lotDto(lot,prices,prefs).valuation;return {tcg:'pokemon',setId:lot.set_id,cardId:lot.card_id,number:json(lot.metadata_json).number,language:lot.language,condition:lot.condition,variant:lot.variant,quantity:lot.quantity,paidCents:lot.paid_cents,acquiredAt:lot.acquired_at,notes:lot.notes,estimatedValueCents:quote&&!quote.stale?quote.valueCents:'',priceSource:quote?.source==='mypcards'?'MYP Cards — média agregada de anúncios PT/EN; condições e acabamentos variados; data de consulta':quote?.sourceLabel||'',quotedAt:quote?.quotedAt||''};});return {csv:exportPersonalCsv(rows),filename:'bkm-minha-colecao-'+stamp().slice(0,10)+'.csv'};}

  async function handle(context) {
    const path=context.path||context.pathname||'',base='/api/account/collection';if(!path.startsWith(base+'/')&&path!==base)return null;const userId=requireOwner(context.user),method=context.method||'GET',query=context.query instanceof URLSearchParams?context.query:new URLSearchParams(context.query||{}),data=context.body||{},route=path.slice(base.length)||'/summary';
    const result=(value,status=200)=>({status,data:value});
    if(route.startsWith('/inventory')){const enhanced=await inventory.handle(userId,method,route,data,query);if(enhanced)return enhanced;}
    if(method==='GET'&&route==='/catalog/search')return result(await enhancedCatalog.search(query));
    if(method==='GET'&&route==='/catalog/sealed')return result(await enhancedCatalog.sealed(query));
    if(method==='GET'&&route==='/summary')return result(await summary(userId));
    if(method==='GET'&&route==='/catalog/sets')return result(await catalogSets(query));
    if(method==='GET'&&route==='/catalog/card'){const card=await canonicalCatalog.card(query.get('cardId'),query.get('setId'),language(query.get('language')||'pt'));return result((await decorateCards([card],{maxRefresh:1}))[0]);}
    if(method==='GET'&&route==='/sets')return result(await listSets(userId));
    if(method==='POST'&&route==='/sets')return result(await addSet(userId,data),201);
    let match=route.match(/^\/sets\/([a-zA-Z0-9-]+)$/);
    if(match){if(method==='GET')return result(await checklist(userId,match[1],query));if(method==='PUT'){await owned('personal_collections',match[1],userId);await db.prepare('UPDATE personal_collections SET goal_json=?,updated_at=? WHERE id=? AND user_id=?').run(JSON.stringify(goalOf(data.goal||data)),stamp(),match[1],userId);return result((await listSets(userId)).items.find(item=>item.id===match[1]));}if(method==='DELETE'){await owned('personal_collections',match[1],userId);await db.prepare('DELETE FROM personal_collections WHERE id=? AND user_id=?').run(match[1],userId);return result({removed:true,inventoryPreserved:true});}}
    if(method==='GET'&&route==='/items')return result(await listLots(userId,query));
    if(method==='POST'&&route==='/items')return result(await saveLot(userId,data),201);
    if(method==='POST'&&route==='/items/batch')return result(await batchLots(userId,data),201);
    match=route.match(/^\/items\/([a-zA-Z0-9-]+)$/);if(match){if(method==='PUT')return result(await saveLot(userId,data,match[1]));if(method==='DELETE'){await owned('personal_lots',match[1],userId);return result(await inventory.remove(userId,match[1],{confirmation:'EXCLUIR'}));}}
    if(method==='GET'&&route==='/wishlist')return result(await wishlist(userId,query));
    if(method==='POST'&&route==='/wishlist')return result(await saveWish(userId,data),201);
    match=route.match(/^\/wishlist\/([a-zA-Z0-9-]+)$/);if(match){if(method==='PUT')return result(await saveWish(userId,data,match[1]));if(method==='DELETE'){await owned('personal_wishlist',match[1],userId);await db.prepare('DELETE FROM personal_wishlist WHERE id=? AND user_id=?').run(match[1],userId);return result({removed:true});}}
    if(method==='GET'&&route==='/preferences')return result(await preferences(userId));
    if(method==='PUT'&&route==='/preferences')return result(await savePreferences(userId,data));
    if(method==='GET'&&route==='/notifications'){const rows=await db.prepare('SELECT * FROM personal_notifications WHERE user_id=? ORDER BY created_at DESC,id LIMIT 2000').all(userId);return result(paginate(rows.map(row=>({id:row.id,kind:row.kind,...json(row.payload_json),readAt:row.read_at,createdAt:row.created_at})),query));}
    match=route.match(/^\/notifications\/([a-zA-Z0-9-]+)$/);if(match&&method==='PUT'){await owned('personal_notifications',match[1],userId);await db.prepare('UPDATE personal_notifications SET read_at=? WHERE id=? AND user_id=?').run(stamp(),match[1],userId);return result({read:true});}
    if(method==='GET'&&route==='/prices')return result(await priceHistory(userId,query));
    if(method==='POST'&&route==='/prices')return result(await recordPrice(userId,data),201);
    if(method==='POST'&&route==='/prices/refresh')return result(await refreshPrice(userId,data));
    if(method==='POST'&&route==='/import/preview')return result(await importPreview(userId,data),201);
    if(method==='POST'&&route==='/import/confirm')return result(await importConfirm(userId,data),201);
    if(method==='GET'&&route==='/export')return result(await exportCollection(userId));
    fail('Recurso da coleção pessoal não encontrado.','NOT_FOUND',404);
  }
  return {handle,summary,catalogSets,cardReference,recordPrice,eligibleWishlistRecipients,onInventoryChange,syncWishlist};
}
module.exports = { createPersonalCollection, LANGUAGES, CONDITIONS, VARIANTS };
