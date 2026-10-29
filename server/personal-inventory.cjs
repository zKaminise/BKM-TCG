'use strict';

// The enhanced collection uses personal_lots, the original private inventory.
// Financial valuations use integer BRL cents; international references remain
// separate native-currency metadata. Store products supply identity snapshots.
const crypto = require('node:crypto');
const {selectInternationalMarket,internationalTotals}=require('./tcgdex-market.cjs');
const {selectMypReference}=require('./mypcards-market.cjs');
const LOCAL_VALUATION=Symbol('localValuation');
const LANGUAGES = ['pt','en','ja','zh-tw','zh-cn','ko','es','fr','de','it','th','id'];
const CONDITIONS = ['M','NM','SP','MP','HP','D','LP','DMG','SEALED','OPENED','CUSTOM'];
const VARIANTS = ['NORMAL','HOLO','REVERSE','PROMO','FIRST_EDITION','POKE_BALL','MASTER_BALL','OTHER'];
const ATTRIBUTES = ['PROMO','STAMP','FIRST_EDITION','SPECIAL_EDITION','OTHER'];
const ITEM_TYPES = ['SINGLE','BOOSTER','BLISTER','DECK','ETB','BOX','TIN','ACCESSORY','CUSTOM'];
const ACTIVE = new Set(['IN_COLLECTION','FOR_SALE']);
const parse = (value, fallback={}) => {try{return JSON.parse(value);}catch{return fallback;}};
const normal = value => String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
const hash = value => crypto.createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const own = (value,key) => Object.prototype.hasOwnProperty.call(value,key);
const unitIdentity = value => hash([value.kind,value.cardId,value.setId,value.referenceLanguage,value.language,value.condition,value.variant,[...value.attributes].sort()]);
function safeImageUrl(value) {
  if(value==null||value==='')return '';
  if(typeof value!=='string'||value.length>2000)throw new Error('Use uma URL HTTPS de imagem válida.');
  if(/^\/(?:assets|uploads)\/[a-zA-Z0-9._/%-]+$/.test(value)&&!/%2e|%2f|%5c|\.\./i.test(value))return value;
  let url;try{url=new URL(value);}catch{throw new Error('Use uma URL HTTPS de imagem válida.');}
  const host=url.hostname.toLowerCase().replace(/^\[|\]$/g,'');
  const ipv4=host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  const privateIp=ipv4&&(+ipv4[1]===0||+ipv4[1]===10||+ipv4[1]===127||+ipv4[1]>=224||(+ipv4[1]===169&&+ipv4[2]===254)||(+ipv4[1]===172&&+ipv4[2]>=16&&+ipv4[2]<=31)||(+ipv4[1]===192&&+ipv4[2]===168)||(+ipv4[1]===100&&+ipv4[2]>=64&&+ipv4[2]<=127));
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||privateIp||host.includes(':')||host==='localhost'||!host.includes('.')||/\.(?:localhost|local|internal|invalid|test)$/.test(host))throw new Error('Use uma imagem HTTPS pública, sem credenciais ou endereço de rede privada.');
  return url.href;
}

function collectionMetrics(items) {
  const result={quantity:0,uniqueCards:0,estimatedValueCents:0,knownValueQuantity:0,brazilianAggregateQuantity:0,estimateIncludesAggregates:false,unpricedQuantity:0,paidCents:0,paidQuantity:0,unknownCostQuantity:0,staleQuantity:0,comparableQuantity:0,comparableCostCents:0,comparableValueCents:0,unrealizedGainCents:0,unrealizedGainPercent:null,coveragePercent:0,partial:false,currency:'BRL',byKind:[],sales:{quantity:0,knownAmountQuantity:0,unknownAmountQuantity:0,amountCents:0,comparableQuantity:0,costCents:0,realizedGainCents:0,realizedGainAvailable:false},archivedQuantity:0};
  const identities=new Set(),kinds=new Map();
  for(const item of items){
    const quantity=item.quantity;
    if(item.status==='ARCHIVED'){result.archivedQuantity+=quantity;continue;}
    if(item.status==='SOLD'){
      const sale=item.sale||{},known=sale.amountCents!==null&&sale.amountCents!==undefined;
      result.sales.quantity+=quantity;
      if(known){result.sales.knownAmountQuantity+=quantity;result.sales.amountCents+=sale.amountCents*quantity;}else result.sales.unknownAmountQuantity+=quantity;
      if(known&&sale.costCents!==null&&sale.costCents!==undefined){result.sales.comparableQuantity+=quantity;result.sales.costCents+=sale.costCents*quantity;result.sales.realizedGainCents+=(sale.amountCents-sale.costCents)*quantity;}
      continue;
    }
    if(!ACTIVE.has(item.status))continue;
    result.quantity+=quantity;identities.add([item.kind,item.cardId,item.referenceLanguage].join('|'));
    let category=kinds.get(item.kind);if(!category){category={kind:item.kind,quantity:0,paidCents:0,estimatedValueCents:0,knownValueQuantity:0};kinds.set(item.kind,category);}category.quantity+=quantity;
    if(item.paidCents!==null){result.paidCents+=item.paidCents*quantity;result.paidQuantity+=quantity;category.paidCents+=item.paidCents*quantity;}else result.unknownCostQuantity+=quantity;
    const quote=item.valuation;
    const brazilian=item.brazilianMarket,staleBrazilian=!quote&&brazilian?.status==='MATCHED'&&brazilian.match==='PRINTING_EXACT'&&brazilian.stale&&Number.isSafeInteger(brazilian.avgPriceCents)&&brazilian.avgPriceCents>0&&['NORMAL','HOLO','REVERSE'].includes(item.variant)&&!item.attributes?.length;
    if(quote?.stale||staleBrazilian)result.staleQuantity+=quantity;
    if(quote&&!quote.stale&&quote.currency==='BRL'&&(quote.match==='EXACT'||quote.match==='PRINTING_EXACT'&&quote.aggregate===true&&quote.usableForBrlValuation===true)){
      result.knownValueQuantity+=quantity;result.estimatedValueCents+=quote.valueCents*quantity;category.estimatedValueCents+=quote.valueCents*quantity;category.knownValueQuantity+=quantity;
      if(quote.source==='mypcards')result.brazilianAggregateQuantity+=quantity;
      if(item.paidCents!==null){result.comparableQuantity+=quantity;result.comparableCostCents+=item.paidCents*quantity;result.comparableValueCents+=quote.valueCents*quantity;}
    }
  }
  result.uniqueCards=identities.size;result.byKind=[...kinds.values()];result.unpricedQuantity=result.quantity-result.knownValueQuantity;result.partial=result.unpricedQuantity>0;result.estimateIncludesAggregates=result.brazilianAggregateQuantity>0;
  result.coveragePercent=result.quantity?Math.round(result.knownValueQuantity/result.quantity*10000)/100:0;
  result.unrealizedGainCents=result.comparableValueCents-result.comparableCostCents;
  result.unrealizedGainPercent=result.comparableCostCents?Math.round(result.unrealizedGainCents/result.comparableCostCents*10000)/100:null;
  result.sales.realizedGainAvailable=result.sales.comparableQuantity>0;
  return result;
}

function createPersonalInventory({db,ApiError,catalog,legacyPrices,preferences,now=Date.now}) {
  const stamp=()=>new Date(now()).toISOString();
  const fail=(message,code='VALIDATION',status=422)=>{throw new ApiError(status,code,message);};
  const text=(value,max=2000)=>{if(value==null)return '';if(typeof value!=='string'||value.length>max)fail(`Texto deve ter até ${max} caracteres.`);return value.trim();};
  const integer=(value,label,min=0,max=100000000)=>{if(!Number.isSafeInteger(value)||value<min||value>max)fail(`Informe ${label} entre ${min} e ${max}.`);return value;};
  const nullableMoney=(value,label)=>value===null||value===undefined||value===''?null:integer(value,label);
  const choice=(value,choices,label)=>{if(!choices.includes(value))fail(`${label} inválido.`);return value;};
  function date(value,label){if(value==null||value==='')return null;if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value||value>new Date(now()).toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'}))fail(`${label} inválida ou futura.`);return value;}
  function url(value){try{return safeImageUrl(value);}catch(error){fail(error.message);}}
  function rowBase(row){return {id:row.id,cardId:row.card_id,setId:row.set_id,language:row.language,referenceLanguage:row.reference_language||row.language,condition:row.condition,variant:row.variant,quantity:row.quantity,paidCents:row.paid_cents,acquiredAt:row.acquired_at,notes:row.notes,photoUrl:row.photo_url,card:parse(row.metadata_json),kind:row.kind||'CARD',itemType:row.item_type||'SINGLE',status:row.status||'IN_COLLECTION',attributes:parse(row.attributes_json,[]),manualValueCents:row.manual_value_cents??null,manualQuotedAt:row.manual_quoted_at||null,sale:parse(row.sale_json),archivedAt:row.archived_at||null,soldAt:row.sold_at||null,revision:row.revision||1,createdAt:row.created_at,updatedAt:row.updated_at};}
  async function owned(userId,id){if(typeof id!=='string'||!/^[-\w]{1,100}$/.test(id))fail('Item não encontrado.','NOT_FOUND',404);const row=await db.prepare('SELECT * FROM personal_lots WHERE id=? AND user_id=?').get(id,userId);if(!row)fail('Item não encontrado.','NOT_FOUND',404);return row;}
  async function lockOwner(userId){if(db.engine==='postgres')await db.prepare('SELECT id FROM users WHERE id=? FOR UPDATE').get(userId);}
  async function prices(userId){const [map,prefs]=await Promise.all([legacyPrices(userId),preferences(userId)]);return {map,prefs,brazilian:map.brazilian||new Map()};}
  function applyBrazilian(item,reference){
    const base=item[LOCAL_VALUATION]??null;
    item.valuation=base;
    item.brazilianMarket=item.kind==='CARD'?selectMypReference(reference||null,item,now()):null;
    // A per-exemplar manual override remains authoritative even when old. A
    // marketplace average is never relabelled as an exact physical condition.
    if(item.manualValueCents===null&&(!base||base.stale)&&item.brazilianMarket?.usableForBrlValuation){
      item.valuation={...item.brazilianMarket,source:'mypcards',valueCents:item.brazilianMarket.avgPriceCents,methodology:'advertised_weighted_mean',market:'BR',coverage:'aggregated_pt_en',manual:false,aggregate:true,conditionAdjusted:false,usableForBrlValuation:true,match:'PRINTING_EXACT'};
    }
    item.estimatedValueCents=item.valuation&&!item.valuation.stale?item.valuation.valueCents:null;
    return item;
  }
  function dto(row,priceContext){
    const item=rowBase(row),{map,prefs}=priceContext;let quote=null;
    if(item.manualValueCents!==null&&row.manual_identity===unitIdentity(item))quote={valueCents:item.manualValueCents,currency:'BRL',source:'user_manual',sourceLabel:'Informado por você',sourceUrl:'',methodology:'manual',market:'user_reference',language:item.language,condition:item.condition,variant:item.variant,attributes:item.attributes,quotedAt:item.manualQuotedAt,recordedAt:row.updated_at,manual:true,match:'EXACT',coverage:'user_reported',stale:!item.manualQuotedAt||now()-Date.parse(item.manualQuotedAt)>prefs.priceTtlDays*86400000};
    else if(item.kind==='CARD'&&item.referenceLanguage===item.language&&!item.attributes.length){
      const rowQuote=map.get([item.cardId,item.language,item.condition,item.variant].join('|'));
      if(rowQuote&&rowQuote.set_id===item.setId&&Number.isSafeInteger(rowQuote.value_cents)&&rowQuote.value_cents>=0)quote={id:rowQuote.id,valueCents:rowQuote.value_cents,currency:'BRL',source:rowQuote.source,sourceLabel:rowQuote.source_label,sourceUrl:rowQuote.source_url,methodology:rowQuote.methodology,quotedAt:rowQuote.quoted_at,recordedAt:rowQuote.recorded_at,coverage:rowQuote.coverage,manual:rowQuote.methodology==='manual',market:rowQuote.methodology==='manual'?'manual_reference':'BR',language:item.language,condition:item.condition,variant:item.variant,attributes:[],match:'EXACT',stale:rowQuote.provider_stale===true||now()-Date.parse(rowQuote.quoted_at)>prefs.priceTtlDays*86400000};
    }
    Object.defineProperty(item,LOCAL_VALUATION,{value:quote,writable:true});
    applyBrazilian(item,parse(row.myp_payload,null)||priceContext.brazilian?.get(item.referenceLanguage+'|'+item.cardId)||item.card?.brazilianMarket);
    item.marketData=item.card?.marketData||null;
    item.internationalMarket=selectInternationalMarket(item.marketData,item,now());
    item.sale={...item.sale,realizedGainCents:item.sale.amountCents!=null&&item.sale.costCents!=null?item.sale.amountCents-item.sale.costCents:null};
    item.warnings=[];
    if(item.kind==='CARD'&&item.referenceLanguage!==item.language)item.warnings.push('Idioma físico informado por você. A imagem é uma referência em outro idioma; impressão e cotação não verificadas para este idioma.');
    if(item.card.variantInformed)item.warnings.push('Variante informada pelo usuário; não verificada no catálogo.');
    return item;
  }
  async function enrichMarket(items,{maxRefresh=8}={}) {
    if(catalog.marketForItems){
      const latest=await catalog.marketForItems(items,{maxRefresh});
      for(const item of items){const data=latest.get(item.referenceLanguage+'|'+item.cardId)||item.marketData;if(data){item.marketData=data;item.internationalMarket=selectInternationalMarket(data,item,now());}}
    }
    if(catalog.brazilianForItems){
      const latest=await catalog.brazilianForItems(items,{maxRefresh:Math.min(2,maxRefresh)});
      for(const item of items)applyBrazilian(item,latest.get(item.referenceLanguage+'|'+item.cardId)||item.brazilianMarket);
    }
    return items;
  }
  async function validate(data,previous=null){
    if(!data||typeof data!=='object'||Array.isArray(data))fail('Item inválido.');
    const existing=previous?rowBase(previous):{},merged={...existing,...data};
    const kind=choice(merged.kind||'CARD',['CARD','SEALED','CUSTOM'],'Tipo de item');
    if(previous&&kind!==existing.kind)fail('Para mudar a categoria, escolha novamente o item no catálogo.');
    const physicalLanguage=choice(merged.language||'pt',LANGUAGES,'Idioma'),referenceLanguage=choice(merged.referenceLanguage||physicalLanguage,LANGUAGES,'Idioma de referência');
    const itemType=choice(merged.itemType||(kind==='CARD'?'SINGLE':kind==='SEALED'?'BOOSTER':'CUSTOM'),ITEM_TYPES,'Categoria');
    if(kind==='CARD'&&itemType!=='SINGLE'||kind==='SEALED'&&['SINGLE','CUSTOM'].includes(itemType)||kind==='CUSTOM'&&itemType==='SINGLE')fail('A categoria não corresponde ao tipo escolhido.');
    let card,cardId,setId;
    if(kind==='CARD'){
      cardId=text(merged.cardId,180);setId=text(merged.setId,80);
      if(previous&&cardId===existing.cardId&&setId===existing.setId&&referenceLanguage===existing.referenceLanguage)card=existing.card;
      else card=await catalog.card(cardId,setId,referenceLanguage);
      cardId=card.providerId||card.id;setId=card.setId;
      if(!cardId||!setId)fail('A identidade da carta não pôde ser verificada.');
      card={...card,language:referenceLanguage,referenceLanguage,imageLanguage:referenceLanguage};
    }else if(kind==='SEALED'&&previous&&existing.card?.sealedId&&(!merged.sealedId||merged.sealedId===existing.card.sealedId)){
      // A personal possession survives removal of its former store listing.
      // Revalidate availability only when selecting a different catalogue item.
      card={...existing.card};cardId=existing.cardId;setId=existing.setId;
    }else if(kind==='SEALED'&&(merged.sealedId||existing.card?.sealedId)){
      const product=await db.prepare("SELECT * FROM products WHERE id=? AND kind='SEALED' AND published=1 AND archived=0").get(text(merged.sealedId||existing.card.sealedId,100));
      if(!product)fail('Selado catalogado não encontrado. Você pode cadastrar um selado manual.','SEALED_NOT_FOUND',404);
      cardId='bkm-'+product.id;setId=product.set_id;const images=parse(product.images_json,[]),first=images[0];
      card={id:cardId,provider:'bkm',providerId:product.id,sealedId:product.id,name:product.name,setId,setName:product.set_name,sku:product.sku,image:typeof first==='string'?url(first):first?.url?url(first.url):'',language:physicalLanguage,referenceLanguage:physicalLanguage,rarity:'',illustrator:'',dexNumbers:[],description:product.description,availableLanguages:[]};
    }else if(previous&&kind!=='CARD'&&!own(data,'title')&&!own(data,'description')){
      card={...existing.card};cardId=existing.cardId;setId=existing.setId;
    }else{
      const title=text(merged.title||existing.card?.name,200);if(!title)fail('Informe o nome do item.');
      if(merged.cardId&&!(previous&&merged.cardId===existing.cardId))fail('Itens manuais não podem assumir uma carta do catálogo.');
      cardId=previous?.card_id||'manual-'+crypto.randomUUID();setId=text(merged.setId||'',80);
      card={id:cardId,name:title,provider:'user',setId,setName:text(merged.setName||existing.card?.setName,200),description:text(merged.description??existing.card?.description,4000),image:url(merged.photoUrl||existing.card?.image),language:physicalLanguage,referenceLanguage:physicalLanguage,rarity:'',illustrator:'',dexNumbers:[],sku:text(merged.sku||existing.card?.sku,100)};
    }
    if(!previous&&kind==='CARD'&&!data.condition)fail('Selecione a condição deste exemplar.');
    const condition=choice(merged.condition||(kind==='SEALED'?'SEALED':kind==='CUSTOM'?'CUSTOM':'NM'),CONDITIONS,'Condição');
    if(kind==='CARD'&&['SEALED','OPENED','CUSTOM'].includes(condition)||kind==='SEALED'&&!['SEALED','OPENED'].includes(condition))fail('Condição incompatível com o tipo do item.');
    const variant=choice(merged.variant||'NORMAL',VARIANTS,'Acabamento');
    if(!Array.isArray(merged.attributes||[])||(merged.attributes||[]).length>10)fail('Atributos inválidos.');
    const attributes=[...new Set((merged.attributes||[]).map(value=>choice(value,ATTRIBUTES,'Atributo')))];
    if(kind==='CARD'){
      const known=card.availableVariants||[],flags=card.variants||{},flag={NORMAL:'normal',HOLO:'holo',REVERSE:'reverse',FIRST_EDITION:'firstEdition'}[variant];
      card.variantInformed=attributes.length>0||!(known.some(value=>(typeof value==='string'?value:value.id)===variant)||flag&&flags[flag]===true);
    }
    const value={kind,itemType,cardId,setId,card,language:physicalLanguage,referenceLanguage,condition,variant,attributes,quantity:integer(merged.quantity??1,'quantidade',1,9999),paidCents:nullableMoney(merged.paidCents,'custo unitário em centavos'),acquiredAt:date(merged.acquiredAt,'Data de aquisição'),notes:text(merged.notes),photoUrl:url(merged.photoUrl),manualValueCents:nullableMoney(merged.manualValueCents,'valor de referência em centavos'),manualQuotedAt:previous?.manual_quoted_at||null};
    if(previous?.status==='SOLD'&&value.quantity!==previous.quantity)fail('Restaure o item antes de alterar a quantidade. O histórico da saída deve permanecer íntegro.');
    if(previous?.title&&previous.quantity===1&&value.quantity!==1)fail('Use “Duplicar exemplar” para adicionar outra unidade com seus próprios dados.');
    if(merged.currency&&merged.currency!=='BRL')fail('Os campos financeiros aceitam somente BRL, sem conversão automática.');
    const identity=unitIdentity(value);
    if(previous&&!own(data,'manualValueCents')&&previous.manual_identity!==identity){value.manualValueCents=null;value.manualQuotedAt=null;}
    if(own(data,'manualValueCents'))value.manualQuotedAt=value.manualValueCents===null?null:stamp();
    if(value.manualValueCents!==null&&!value.manualQuotedAt)value.manualQuotedAt=stamp();
    value.manualIdentity=value.manualValueCents===null?'':identity;
    return value;
  }
  function record(userId,value,id=crypto.randomUUID(),previous=null){
    const meta=value.card,number=String(meta.number||meta.localNumber||''),dex=meta.dexNumbers||meta.dex_numbers||[];
    return {id,user_id:userId,set_id:value.setId,card_id:value.cardId,language:value.language,condition:value.condition,variant:value.variant,quantity:value.quantity,paid_cents:value.paidCents,acquired_at:value.acquiredAt,notes:value.notes,photo_url:value.photoUrl,metadata_json:JSON.stringify(meta),search_text:normal([meta.name,meta.setName,value.setId,number,meta.displayNumber,value.notes,meta.description].join(' ')),created_at:previous?.created_at||stamp(),updated_at:stamp(),kind:value.kind,item_type:value.itemType,status:previous?.status||'IN_COLLECTION',reference_language:value.referenceLanguage,attributes_json:JSON.stringify(value.attributes),manual_value_cents:value.manualValueCents,manual_quoted_at:value.manualQuotedAt,manual_identity:value.manualIdentity,sale_json:previous?.sale_json||'{}',archived_at:previous?.archived_at||null,sold_at:previous?.sold_at||null,revision:(previous?.revision||0)+1,title:String(meta.name||''),set_name:String(meta.setName||''),rarity:String(meta.rarity||''),illustrator:String(meta.illustrator||''),dex_number:Array.isArray(dex)&&Number.isSafeInteger(dex[0])?dex[0]:null,number_sort:/^\d+$/.test(number)?Number(number):null};
  }
  async function insert(row){const columns=Object.keys(row);await db.prepare('INSERT INTO personal_lots('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')').run(...columns.map(key=>row[key]));}
  async function update(row){const columns=Object.keys(row).filter(key=>!['id','user_id','created_at'].includes(key));await db.prepare('UPDATE personal_lots SET '+columns.map(key=>key+'=?').join(',')+' WHERE id=? AND user_id=?').run(...columns.map(key=>row[key]),row.id,row.user_id);}
  function request(data,action){const key=data.requestId||data.idempotencyKey||crypto.randomUUID();if(typeof key!=='string'||!/^[a-zA-Z0-9_.:-]{8,120}$/.test(key))fail('Identificador de operação inválido.');const copy={...data};delete copy.requestId;delete copy.idempotencyKey;return {key,fingerprint:hash({action,data:copy}),action};}
  async function replay(userId,req){const prior=await db.prepare('SELECT * FROM personal_inventory_operations WHERE user_id=? AND request_key=?').get(userId,req.key);if(!prior)return null;if(prior.fingerprint!==req.fingerprint)fail('Esta operação já foi utilizada com outros dados. Atualize a página e tente novamente.','IDEMPOTENCY_CONFLICT',409);return parse(prior.result_json);}
  async function operation(userId,req,before,after,result){
    const id=crypto.randomUUID(),output={...result,operationId:id};
    await db.prepare('INSERT INTO personal_inventory_operations(id,user_id,request_key,action,fingerprint,before_json,after_json,result_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,userId,req.key,req.action,req.fingerprint,JSON.stringify(before),JSON.stringify(after),JSON.stringify(output),stamp());
    const old=new Map(before.map(row=>[row.id,row]));
    for(const row of after){await db.prepare('INSERT INTO personal_item_events(id,user_id,lot_id,operation_id,kind,payload_json,created_at) VALUES(?,?,?,?,?,?,?)').run(crypto.randomUUID(),userId,row.id,id,req.action,JSON.stringify({before:old.has(row.id)?rowBase(old.get(row.id)):null,after:rowBase(row)}),stamp());old.delete(row.id);}
    for(const row of old.values())await db.prepare('INSERT INTO personal_item_events(id,user_id,lot_id,operation_id,kind,payload_json,created_at) VALUES(?,?,?,?,?,?,?)').run(crypto.randomUUID(),userId,row.id,id,req.action,JSON.stringify({before:rowBase(row),after:null}),stamp());
    return output;
  }
  async function createBatch(userId,data){
    if(!data.requestId&&!data.idempotencyKey)fail('Informe o identificador de envio para proteger contra duplicações.');
    const req=request(data,'ADD'),previous=await replay(userId,req);if(previous)return previous;
    if(!Array.isArray(data.items)||!data.items.length||data.items.length>200)fail('Escolha de 1 a 200 itens por envio.');
    const requestedUnits=data.items.reduce((sum,item)=>sum+integer(item?.quantity??1,'quantidade',1,9999),0);
    if(requestedUnits>200)fail('Adicione até 200 exemplares por envio.');
    const validateAll=async()=>{
      const values=new Array(data.items.length);let index=0,firstError;
      // Resolve at most four remote identities at once under ONE operation
      // deadline. Await all started workers before returning a failed batch.
      await Promise.all(Array.from({length:Math.min(4,data.items.length)},async()=>{
        while(!firstError&&index<data.items.length){const at=index++;try{values[at]=await validate(data.items[at]);}catch(error){firstError||=error;}}
      }));
      if(firstError)throw firstError;
      return values.flatMap(value=>Array.from({length:value.quantity},()=>({...value,quantity:1})));
    };
    const validated=await (catalog.withBudget?catalog.withBudget(validateAll):validateAll());
    const context=await prices(userId);
    return db.transaction(async()=>{await lockOwner(userId);const again=await replay(userId,req);if(again)return again;const count=(await db.prepare('SELECT COUNT(*) count FROM personal_lots WHERE user_id=?').get(userId)).count;if(Number(count)+validated.length>10000)fail('Limite de 10.000 exemplares pessoais atingido.');const rows=validated.map(value=>record(userId,value));for(const row of rows)await insert(row);return operation(userId,req,[],rows,{items:rows.map(row=>dto(row,context)),added:rows.length});});
  }
  async function edit(userId,id,data){
    const req=request({...data,id},'EDIT'),oldResult=await replay(userId,req);if(oldResult)return oldResult;
    const previous=await owned(userId,id);if(data.revision!==undefined&&data.revision!==previous.revision)fail('Este item foi alterado. Recarregue antes de editar.','COLLECTION_CONFLICT',409);
    const valid=await validate(data,previous),context=await prices(userId);
    return db.transaction(async()=>{await lockOwner(userId);const again=await replay(userId,req);if(again)return again;const current=await owned(userId,id);if(current.revision!==previous.revision)fail('Este item foi alterado. Recarregue antes de editar.','COLLECTION_CONFLICT',409);const row=record(userId,valid,id,current);await update(row);return operation(userId,req,[current],[row],{item:dto(row,context),items:[dto(row,context)],changed:1});});
  }
  async function selected(userId,ids){if(!Array.isArray(ids)||!ids.length||ids.length>200||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!/^[-\w]{1,100}$/.test(id)))fail('Selecione de 1 a 200 itens distintos.');const rows=await db.prepare('SELECT * FROM personal_lots WHERE user_id=? AND id IN('+ids.map(()=>'?').join(',')+') ORDER BY created_at,id'+db.lockSuffix).all(userId,...ids);if(rows.length!==ids.length)fail('Um dos itens não foi encontrado.','NOT_FOUND',404);return rows;}
  async function bulk(userId,data){
    if(data.action==='undo')return undo(userId,data);
    const action=choice(data.action,['cost','sell','archive','restore','edit'],'Ação'),req=request(data,action.toUpperCase()),oldResult=await replay(userId,req);if(oldResult)return oldResult;
    const context=await prices(userId);
    let paidCents,amountCents,mode='unit',acquiredAt,exitType,soldDate,notes,changes;
    if(action==='cost'){if(!own(data,'paidCents')&&!own(data,'acquiredAt'))fail('Escolha quais dados deseja alterar.');if(own(data,'paidCents'))paidCents=nullableMoney(data.paidCents,'custo em centavos');if(own(data,'acquiredAt'))acquiredAt=date(data.acquiredAt,'Data de aquisição');mode=choice(data.mode||'unit',['unit','total'],'Modo do valor');}
    if(action==='sell'){amountCents=nullableMoney(data.amountCents,'valor recebido em centavos');mode=choice(data.mode||'unit',['unit','total'],'Modo do valor');exitType=choice(data.exitType||'SALE',['SALE','TRADE','DONATION','OTHER'],'Tipo de saída');if(exitType!=='SALE'&&amountCents!==null)fail('Troca, doação e outras saídas sem venda não têm valor de venda. Deixe o valor vazio.');soldDate=date(data.date,'Data da saída');notes=text(data.notes);}
    if(action==='edit'){changes=data.changes;if(!changes||typeof changes!=='object'||Array.isArray(changes)||!Object.keys(changes).length||Object.keys(changes).some(key=>!['condition','language','variant','attributes','notes'].includes(key)))fail('Campos de edição em massa inválidos.');}
    return db.transaction(async()=>{
      await lockOwner(userId);const again=await replay(userId,req);if(again)return again;
      const before=await selected(userId,data.ids),after=[];let targets=[];
      if(['sell','cost'].includes(action)){
        for(const source of before){
          if(!ACTIVE.has(source.status))fail('Selecione apenas itens que ainda estão em coleção.');
          const requested=action==='sell'&&data.quantities&&own(data.quantities,source.id)?integer(data.quantities[source.id],'quantidade de saída',1,source.quantity):source.quantity;
          if(targets.length+requested>200)fail('Altere até 200 exemplares por operação.');
          if(requested<source.quantity){const remaining={...source,quantity:source.quantity-requested,revision:source.revision+1,updated_at:stamp()};await update(remaining);after.push(remaining);for(let i=0;i<requested;i++)targets.push({...source,id:crypto.randomUUID(),quantity:1,revision:1,created_at:stamp(),updated_at:stamp(),_new:true});}
          else for(let i=0;i<requested;i++)targets.push({...source,id:i===0?source.id:crypto.randomUUID(),quantity:1,revision:i===0?source.revision+1:1,updated_at:stamp(),_new:i!==0});
        }
      }else targets=before.map(row=>({...row,revision:row.revision+1,updated_at:stamp()}));
      const distribute=(value,index)=>value===null?null:mode==='total'?Math.floor(value/targets.length)+(index<value%targets.length?1:0):value;
      for(let i=0;i<targets.length;i++){
        let row=targets[i];
        if(action==='cost'){if(paidCents!==undefined)row.paid_cents=distribute(paidCents,i);if(acquiredAt!==undefined)row.acquired_at=acquiredAt;}
        if(action==='sell'){row.status='SOLD';row.sold_at=stamp();row.sale_json=JSON.stringify({amountCents:distribute(amountCents,i),costCents:row.paid_cents,exitType,date:soldDate,notes});}
        if(action==='archive'){if(!ACTIVE.has(row.status))fail('Selecione apenas itens ativos para arquivar.');row.status='ARCHIVED';row.archived_at=stamp();}
        if(action==='restore'){if(!['ARCHIVED','SOLD'].includes(row.status))fail('Selecione apenas itens vendidos ou arquivados para restaurar.');row.status='IN_COLLECTION';row.archived_at=null;row.sold_at=null;row.sale_json='{}';}
        if(action==='edit'){
          // No remote catalogue calls occur under the owner lock; the existing
          // identity snapshot remains, and changing physical details clears quote.
          const value=rowBase(row);
          if(own(changes,'language'))row.language=choice(changes.language,LANGUAGES,'Idioma');
          if(own(changes,'condition')){row.condition=choice(changes.condition,CONDITIONS,'Condição');if(row.kind==='CARD'&&['SEALED','OPENED','CUSTOM'].includes(row.condition)||row.kind==='SEALED'&&!['SEALED','OPENED'].includes(row.condition))fail('Condição incompatível com o tipo do item.');}
          if(own(changes,'variant'))row.variant=choice(changes.variant,VARIANTS,'Acabamento');
          if(own(changes,'attributes')){if(!Array.isArray(changes.attributes)||changes.attributes.length>10)fail('Atributos inválidos.');row.attributes_json=JSON.stringify([...new Set(changes.attributes.map(attribute=>choice(attribute,ATTRIBUTES,'Atributo')))]);}
          if(own(changes,'notes'))row.notes=text(changes.notes);
          if(unitIdentity(rowBase(row))!==unitIdentity(value)){row.manual_value_cents=null;row.manual_quoted_at=null;row.manual_identity='';}
          if(row.kind==='CARD'){const meta=parse(row.metadata_json),variantOptions=meta.availableVariants||[],flags=meta.variants||{},flag={NORMAL:'normal',HOLO:'holo',REVERSE:'reverse',FIRST_EDITION:'firstEdition'}[row.variant];meta.variantInformed=parse(row.attributes_json,[]).length>0||!(variantOptions.some(option=>(typeof option==='string'?option:option.id)===row.variant)||flag&&flags[flag]===true);row.metadata_json=JSON.stringify(meta);}
        }
        const meta=parse(row.metadata_json);row.search_text=normal([meta.name,meta.setName,row.set_id,meta.number,meta.displayNumber,row.notes,meta.description].join(' '));
        const isNew=row._new;delete row._new;if(isNew)await insert(row);else await update(row);after.push(row);
      }
      return operation(userId,req,before,after,{items:after.map(row=>dto(row,context)),changed:targets.length});
    });
  }
  async function undo(userId,data){
    const req=request(data,'UNDO'),oldResult=await replay(userId,req);if(oldResult)return oldResult;
    if(typeof data.operationId!=='string'||!/^[-\w]{1,100}$/.test(data.operationId))fail('Operação inválida.');
    const context=await prices(userId);
    return db.transaction(async()=>{await lockOwner(userId);const again=await replay(userId,req);if(again)return again;const op=await db.prepare('SELECT * FROM personal_inventory_operations WHERE id=? AND user_id=?'+db.lockSuffix).get(data.operationId,userId);if(!op)fail('Operação não encontrada.','NOT_FOUND',404);if(op.undone_at)fail('Esta operação já foi desfeita.','ALREADY_UNDONE',409);if(!['SELL','ARCHIVE','RESTORE','COST','EDIT','ADD'].includes(op.action))fail('Esta operação não pode ser desfeita.');const before=parse(op.before_json,[]),after=parse(op.after_json,[]),current=[];
      for(const expected of after){const row=await owned(userId,expected.id);if(row.revision!==expected.revision)fail('Um item foi alterado depois desta ação. Revise-o antes de desfazer.','UNDO_CONFLICT',409);current.push(row);}
      const oldIds=new Set(before.map(row=>row.id));for(const row of current)if(!oldIds.has(row.id))await db.prepare('DELETE FROM personal_lots WHERE id=? AND user_id=?').run(row.id,userId);
      const restored=[];for(const old of before){const currentRow=current.find(row=>row.id===old.id),value={...old,revision:(currentRow?.revision||old.revision)+1,updated_at:stamp()};if(currentRow)await update(value);else await insert(value);restored.push(value);}
      await db.prepare('UPDATE personal_inventory_operations SET undone_at=? WHERE id=? AND user_id=?').run(stamp(),op.id,userId);
      return operation(userId,req,current,restored,{items:restored.map(row=>dto(row,context)),changed:restored.length,undoneOperationId:op.id});
    });
  }
  async function remove(userId,id,data){if(data.confirmation!=='EXCLUIR')fail('Confirme digitando EXCLUIR para excluir permanentemente.');const req=request({...data,id},'DELETE'),oldResult=await replay(userId,req);if(oldResult)return oldResult;return db.transaction(async()=>{await lockOwner(userId);const again=await replay(userId,req);if(again)return again;const row=await owned(userId,id);await db.prepare('DELETE FROM personal_lots WHERE id=? AND user_id=?').run(id,userId);return operation(userId,req,[row],[],{removed:true,id});});}
  async function events(userId,query){const args=[userId],where=['user_id=?'];if(query.get('itemId')){await owned(userId,query.get('itemId'));where.push('lot_id=?');args.push(query.get('itemId'));}const page=Math.max(1,Number.parseInt(query.get('page')||'1',10)||1),pageSize=Math.max(1,Math.min(60,Number.parseInt(query.get('pageSize')||'24',10)||24)),sql=where.join(' AND '),count=await db.prepare('SELECT COUNT(*) count FROM personal_item_events WHERE '+sql).get(...args),rows=await db.prepare('SELECT * FROM personal_item_events WHERE '+sql+' ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?').all(...args,pageSize,(page-1)*pageSize);return {items:rows.map(row=>({id:row.id,itemId:row.lot_id,operationId:row.operation_id,kind:row.kind,...parse(row.payload_json),createdAt:row.created_at})),total:Number(count.count),page,pageSize};}
  const jsonText=(alias,key)=>db.engine==='postgres'?`(${alias}.metadata_json::jsonb->>'${key}')`:`json_extract(${alias}.metadata_json,'$.${key}')`;
  const numberExpr=alias=>{const field=jsonText(alias,'number');return `COALESCE(${alias}.number_sort,CASE WHEN ${db.engine==='postgres'?`${field} ~ '^[0-9]+$'`:`${field}<>'' AND ${field} NOT GLOB '*[^0-9]*'`} THEN CAST(${field} AS INTEGER) ELSE NULL END)`;};
  const dexExpr=alias=>`COALESCE(${alias}.dex_number,${db.engine==='postgres'?`CAST((${alias}.metadata_json::jsonb->'dexNumbers'->>0) AS INTEGER)`:`CAST(json_extract(${alias}.metadata_json,'$.dexNumbers[0]') AS INTEGER)`})`;
  const labelExpr=(alias,column,key)=>`COALESCE(NULLIF(${alias}.${column},''),${jsonText(alias,key)},'')`;
  function priced(userId,prefs){
    const cutoff=new Date(now()-prefs.priceTtlDays*86400000).toISOString();
    // Latest references are joined in one query; no card-by-card HTTP/database
    // requests and no thousands of image/notes payloads for a paginated view.
    const eligible="l.kind='CARD' AND COALESCE(NULLIF(l.reference_language,''),l.language)=l.language AND l.attributes_json='[]'";
    const j=key=>db.engine==='postgres'?`(l.myp_payload::jsonb->>'${key}')`:`json_extract(l.myp_payload,'$.${key}')`;
    const rawAverage=j('avgPriceCents'),average=db.engine==='postgres'?`CASE WHEN COALESCE(${rawAverage},'') ~ '^[0-9]{1,9}$' THEN CAST(${rawAverage} AS BIGINT) ELSE NULL END`:`CASE WHEN json_type(l.myp_payload,'$.avgPriceCents')='integer' THEN ${rawAverage} ELSE NULL END`;
    const compatible=`${eligible} AND l.language IN('pt','en') AND l.variant IN('NORMAL','HOLO','REVERSE') AND ${j('source')}='mypcards' AND ${j('status')}='MATCHED' AND ${j('match')}='PRINTING_EXACT' AND ${j('currency')}='BRL' AND ${j('cardId')}=l.card_id AND ${j('setId')}=l.set_id AND ${j('referenceLanguage')}=COALESCE(NULLIF(l.reference_language,''),l.language) AND (${average})>0 AND (${average})<=100000000`;
    // expires_at can be a retry cooldown after a failed refresh; original
    // observation/expiry and stale flag must also be checked independently.
    const fresh=`${compatible} AND l.myp_expires>l.tick AND ${j('expiresAt')}>l.snapshot AND ${j('fetchedAt')}>l.recent AND ${j('fetchedAt')}<=l.snapshot AND COALESCE(CAST(${j('stale')} AS TEXT),'false') NOT IN('true','1')`;
    const manual="l.manual_value_cents IS NOT NULL AND l.manual_identity<>''",local=`COALESCE(CASE WHEN l.private_quoted>=l.cutoff THEN l.private_value ELSE NULL END,CASE WHEN l.global_quoted>=l.cutoff THEN l.global_value ELSE NULL END)`;
    return {sql:`WITH clock AS(SELECT CAST(? AS TEXT) cutoff,CAST(? AS TEXT) snapshot,CAST(? AS TEXT) recent,CAST(? AS BIGINT) tick),private_rank AS(SELECT p.*,ROW_NUMBER() OVER(PARTITION BY card_id,set_id,language,condition,variant ORDER BY quoted_at DESC,recorded_at DESC,id DESC) AS n FROM personal_prices p WHERE user_id=?),global_rank AS(SELECT p.*,ROW_NUMBER() OVER(PARTITION BY card_id,set_id,language,condition,variant ORDER BY quoted_at DESC,recorded_at DESC,id DESC) AS n FROM market_quotes p WHERE currency='BRL' AND rights_confirmed=1 AND card_id IN(SELECT card_id FROM personal_lots WHERE user_id=?)),joined AS(SELECT l.*,c.*,p.id private_id,p.value_cents private_value,p.quoted_at private_quoted,g.id global_id,g.value_cents global_value,g.quoted_at global_quoted,m.payload_json myp_payload,m.expires_at myp_expires FROM personal_lots l CROSS JOIN clock c LEFT JOIN private_rank p ON p.n=1 AND p.card_id=l.card_id AND p.set_id=l.set_id AND p.language=l.language AND p.condition=l.condition AND p.variant=l.variant LEFT JOIN global_rank g ON g.n=1 AND g.card_id=l.card_id AND g.set_id=l.set_id AND g.language=l.language AND g.condition=l.condition AND g.variant=l.variant LEFT JOIN personal_reference_cache m ON m.cache_key='myp:price:v1:'||COALESCE(NULLIF(l.reference_language,''),l.language)||'|'||l.card_id AND m.kind='myp-price' WHERE l.user_id=?),priced AS(SELECT l.*,CASE WHEN ${manual} THEN CASE WHEN l.manual_quoted_at>=l.cutoff THEN l.manual_value_cents ELSE NULL END WHEN ${eligible} THEN COALESCE(${local},CASE WHEN ${fresh} THEN (${average}) ELSE NULL END) ELSE NULL END quote_value,CASE WHEN NOT(${manual}) AND ${local} IS NULL AND ${fresh} THEN 'mypcards' ELSE 'local' END quote_origin,CASE WHEN ${manual} THEN CASE WHEN l.manual_quoted_at>=l.cutoff THEN 0 ELSE 1 END WHEN ${local} IS NOT NULL OR ${fresh} THEN 0 WHEN ${eligible} AND (l.private_id IS NOT NULL OR l.global_id IS NOT NULL) OR ${compatible} THEN 1 ELSE 0 END quote_stale FROM joined l)`,args:[cutoff,stamp(),new Date(now()-86400000).toISOString(),now(),userId,userId,userId]};
  }
  function filterSql(query){
    const where=[],args=[],status=query.get('status')||'ACTIVE';
    if(status==='ACTIVE')where.push("status IN('IN_COLLECTION','FOR_SALE')");else if(status!=='ALL'){choice(status,['IN_COLLECTION','FOR_SALE','SOLD','ARCHIVED'],'Situação');where.push('status=?');args.push(status);}
    for(const [key,column]of[['kind','kind'],['language','language'],['condition','condition'],['variant','variant'],['cardId','card_id']])if(query.get(key)){where.push(column+'=?');args.push(query.get(key));}
    if(query.get('setId')){const ids=query.get('setId').split(',').filter(Boolean).slice(0,30);if(ids.length){where.push('set_id IN('+ids.map(()=>'?').join(',')+')');args.push(...ids);}}
    for(const word of normal(query.get('q')).split(' ').filter(Boolean).slice(0,8)){where.push("search_text LIKE ? ESCAPE '\\'");args.push('%'+word.replace(/[\\%_]/g,'\\$&')+'%');}
    for(const [key,operator]of[['acquiredFrom','>='],['acquiredTo','<=']])if(query.get(key)){where.push('acquired_at'+operator+'?');args.push(date(query.get(key),'Data de aquisição'));}
    if(query.get('rarity')){where.push(labelExpr('priced','rarity','rarity')+'=?');args.push(query.get('rarity'));}
    const price=query.get('price'),cost=query.get('cost');
    if(price==='known')where.push('quote_value IS NOT NULL');if(price==='missing')where.push('quote_value IS NULL');if(price==='stale')where.push('quote_stale=1');
    if(cost==='known')where.push('paid_cents IS NOT NULL');if(cost==='missing')where.push('paid_cents IS NULL');
    for(const [key,column]of[['Cost','paid_cents'],['Value','quote_value']])for(const [prefix,operator]of[['min','>='],['max','<=']])if(query.has(prefix+key)){where.push(column+operator+'?');args.push(integer(Number(query.get(prefix+key)),'valor do filtro'));}
    return {sql:where.length?' WHERE '+where.join(' AND '):'',args};
  }
  async function aggregateStats(userId,prefs){
    const source=priced(userId,prefs),active="status IN('IN_COLLECTION','FOR_SALE')",comparable=`${active} AND quote_value IS NOT NULL AND paid_cents IS NOT NULL`,saleAmount=db.engine==='postgres'?"CAST(sale_json::jsonb->>'amountCents' AS BIGINT)":"json_extract(sale_json,'$.amountCents')",saleCost=db.engine==='postgres'?"CAST(sale_json::jsonb->>'costCents' AS BIGINT)":"json_extract(sale_json,'$.costCents')";
    const sum=(condition,value='quantity')=>`COALESCE(SUM(CASE WHEN ${condition} THEN ${value} ELSE 0 END),0)`;
    const row=await db.prepare(source.sql+` SELECT ${sum(active)} quantity,COUNT(DISTINCT CASE WHEN ${active} THEN kind||'|'||card_id||'|'||COALESCE(NULLIF(reference_language,''),language) ELSE NULL END) unique_cards,${sum(`${active} AND quote_value IS NOT NULL`,'quote_value*quantity')} estimated_value,${sum(`${active} AND quote_value IS NOT NULL`)} valued_quantity,${sum(`${active} AND quote_value IS NOT NULL AND quote_origin='mypcards'`)} brazilian_quantity,${sum(`${active} AND paid_cents IS NOT NULL`,'paid_cents*quantity')} paid,${sum(`${active} AND paid_cents IS NOT NULL`)} paid_quantity,${sum(`${active} AND quote_stale=1`)} stale,${sum(comparable)} comparable,${sum(comparable,'paid_cents*quantity')} comparable_cost,${sum(comparable,'quote_value*quantity')} comparable_value,${sum("status='ARCHIVED'")} archived,${sum("status='SOLD'")} sold,${sum(`status='SOLD' AND ${saleAmount} IS NOT NULL`)} sold_known,${sum(`status='SOLD' AND ${saleAmount} IS NOT NULL`,saleAmount+'*quantity')} sold_amount,${sum(`status='SOLD' AND ${saleAmount} IS NOT NULL AND ${saleCost} IS NOT NULL`)} sold_comparable,${sum(`status='SOLD' AND ${saleAmount} IS NOT NULL AND ${saleCost} IS NOT NULL`,saleCost+'*quantity')} sold_cost,${sum(`status='SOLD' AND ${saleAmount} IS NOT NULL AND ${saleCost} IS NOT NULL`,'('+saleAmount+'-'+saleCost+')*quantity')} sold_gain FROM priced`).get(...source.args);
    const result=collectionMetrics([]),n=key=>Number(row[key]||0);
    Object.assign(result,{quantity:n('quantity'),uniqueCards:n('unique_cards'),estimatedValueCents:n('estimated_value'),knownValueQuantity:n('valued_quantity'),paidCents:n('paid'),paidQuantity:n('paid_quantity'),staleQuantity:n('stale'),comparableQuantity:n('comparable'),comparableCostCents:n('comparable_cost'),comparableValueCents:n('comparable_value'),archivedQuantity:n('archived')});
    result.brazilianAggregateQuantity=n('brazilian_quantity');result.estimateIncludesAggregates=result.brazilianAggregateQuantity>0;
    result.unknownCostQuantity=result.quantity-result.paidQuantity;result.unpricedQuantity=result.quantity-result.knownValueQuantity;result.partial=result.unpricedQuantity>0;result.coveragePercent=result.quantity?Math.round(result.knownValueQuantity/result.quantity*10000)/100:0;result.unrealizedGainCents=result.comparableValueCents-result.comparableCostCents;result.unrealizedGainPercent=result.comparableCostCents?Math.round(result.unrealizedGainCents/result.comparableCostCents*10000)/100:null;
    result.sales={quantity:n('sold'),knownAmountQuantity:n('sold_known'),unknownAmountQuantity:n('sold')-n('sold_known'),amountCents:n('sold_amount'),comparableQuantity:n('sold_comparable'),costCents:n('sold_cost'),realizedGainCents:n('sold_gain'),realizedGainAvailable:n('sold_comparable')>0};
    result.byKind=(await db.prepare(source.sql+` SELECT kind,${sum(active)} quantity,${sum(`${active} AND paid_cents IS NOT NULL`,'paid_cents*quantity')} paid,${sum(`${active} AND quote_value IS NOT NULL`,'quote_value*quantity')} estimated,${sum(`${active} AND quote_value IS NOT NULL`)} valued FROM priced GROUP BY kind`).all(...source.args)).filter(row=>Number(row.quantity)>0).map(row=>({kind:row.kind,quantity:Number(row.quantity),paidCents:Number(row.paid),estimatedValueCents:Number(row.estimated),knownValueQuantity:Number(row.valued)}));
    return result;
  }
  async function list(userId,query){
    const prefs=await preferences(userId),filter=filterSql(query);let source=priced(userId,prefs),args=[...source.args,...filter.args],filtered=source.sql+',filtered AS(SELECT * FROM priced'+filter.sql+')';
    const sort=choice(query.get('sort')||'default',['default','dex','number','set','rarity','name','acquired','cost','value','recent'],'Ordenação'),dir=choice(query.get('dir')||(['default','recent'].includes(sort)?'desc':'asc'),['asc','desc'],'Direção').toUpperCase();
    const sortField=({default:'created_at',recent:'created_at',dex:dexExpr('filtered'),number:numberExpr('filtered'),set:labelExpr('filtered','set_name','setName'),rarity:labelExpr('filtered','rarity','rarity'),name:labelExpr('filtered','title','name'),acquired:'acquired_at',cost:'paid_cents',value:'quote_value'})[sort];
    const page=Math.max(1,Math.min(10000,Number.parseInt(query.get('page')||'1',10)||1)),pageSize=Math.max(1,Math.min(60,Number.parseInt(query.get('pageSize')||'24',10)||24));
    const readRows=()=>db.prepare(filtered+` SELECT * FROM filtered ORDER BY CASE WHEN ${sortField} IS NULL OR CAST(${sortField} AS TEXT)='' THEN 1 ELSE 0 END ASC,${sortField} ${dir},id ASC LIMIT ? OFFSET ?`).all(...args,pageSize,(page-1)*pageSize);
    let counts=await db.prepare(filtered+' SELECT COUNT(*) count FROM filtered').get(...args),rows=await readRows();
    const context=await prices(userId);let items=await enrichMarket(rows.map(row=>dto(row,context)));
    if(catalog.brazilianForItems){
      source=priced(userId,prefs);args=[...source.args,...filter.args];filtered=source.sql+',filtered AS(SELECT * FROM priced'+filter.sql+')';
      if(sort==='value'||query.get('price')||query.has('minValue')||query.has('maxValue')){counts=await db.prepare(filtered+' SELECT COUNT(*) count FROM filtered').get(...args);rows=await readRows();items=await enrichMarket(rows.map(row=>dto(row,context)),{maxRefresh:0});}
    }
    const totals=await aggregateStats(userId,prefs);
    const setLabel=labelExpr('personal_lots','set_name','setName');
    const facetRows=await db.prepare(`SELECT 'sets' facet,set_id value,MAX(${setLabel}) label FROM personal_lots WHERE user_id=? AND set_id<>'' GROUP BY set_id UNION ALL SELECT 'languages',language,language FROM personal_lots WHERE user_id=? GROUP BY language UNION ALL SELECT 'conditions',condition,condition FROM personal_lots WHERE user_id=? GROUP BY condition UNION ALL SELECT 'variants',variant,variant FROM personal_lots WHERE user_id=? GROUP BY variant UNION ALL SELECT 'rarities',${labelExpr('personal_lots','rarity','rarity')},${labelExpr('personal_lots','rarity','rarity')} FROM personal_lots WHERE user_id=? GROUP BY ${labelExpr('personal_lots','rarity','rarity')} UNION ALL SELECT 'kinds',kind,kind FROM personal_lots WHERE user_id=? GROUP BY kind`).all(userId,userId,userId,userId,userId,userId);
    const facets={sets:[],languages:[],conditions:[],variants:[],rarities:[],kinds:[]};for(const row of facetRows)if(row.value)facets[row.facet].push(row.facet==='sets'?{id:row.value,name:row.label||row.value}:row.value);
    const group=choice(query.get('group')||'none',['none','set','pokemon','rarity','illustrator','status'],'Agrupamento');let groups=[];
    if(group!=='none'){
      const groupExpr=group==='set'?`COALESCE(NULLIF(set_id,''),'manual:'||NULLIF(${labelExpr('filtered','set_name','setName')},''),'unknown')`:group==='status'?'status':group==='pokemon'?`COALESCE(CAST(${dexExpr('filtered')} AS TEXT),CASE WHEN kind='CARD' THEN 'non-pokemon' ELSE kind END)`:labelExpr('filtered',group,group);
      const groupLabel=group==='set'?labelExpr('filtered','set_name','setName'):groupExpr;
      groups=(await db.prepare(filtered+` SELECT ${groupExpr} group_key,MAX(${groupLabel}) group_label,SUM(quantity) quantity,COALESCE(SUM(quote_value*quantity),0) estimated,SUM(CASE WHEN quote_value IS NOT NULL THEN quantity ELSE 0 END) valued FROM filtered GROUP BY ${groupExpr} ORDER BY ${groupExpr}`).all(...args)).map(row=>({key:group==='pokemon'&&/^\d+$/.test(row.group_key)?'dex-'+row.group_key:row.group_key||'unknown',label:group==='pokemon'&&/^\d+$/.test(row.group_key)?'Pokédex #'+row.group_key:group==='pokemon'&&row.group_key==='non-pokemon'?'Treinadores, energias e cartas sem Pokédex':row.group_label||'Sem informação',quantity:Number(row.quantity),estimatedValueCents:Number(row.estimated),knownValueQuantity:Number(row.valued)}));
    }
    return {items,total:Number(counts.count),page,pageSize,totals,facets,groups,currency:'BRL',internationalTotals:internationalTotals(items),internationalScope:'page',priceProviders:{automaticBrazilian:catalog.brazilianEnabled===true,automaticInternational:true,manual:true,brazilianSource:'MYP Cards',brazilianMethodology:'advertised_weighted_mean',message:'Referências brasileiras MYP Cards em BRL quando há impressão e idioma compatíveis; valores agregam anúncios PT/EN, condições e acabamentos. Referências internacionais EUR/USD permanecem separadas. Ausência de acesso ou de correspondência não gera preço inventado.'}};
  }
  async function stats(userId){return aggregateStats(userId,await preferences(userId));}
  async function handle(userId,method,route,data,query){
    if(route==='/inventory'&&method==='GET')return {status:200,data:await list(userId,query)};
    if(route==='/inventory/market-refresh'&&method==='POST'){
      if(!Array.isArray(data.ids)||!data.ids.length||data.ids.length>24)fail('Escolha de 1 a 24 itens para consultar as referências.');
      const rows=await selected(userId,data.ids),context=await prices(userId),items=await enrichMarket(rows.map(row=>dto(row,context)),{maxRefresh:24});
      return {status:200,data:{items,internationalTotals:internationalTotals(items),cachePolicy:'daily',message:'Referências consultadas com cache diário. A conservação e o idioma de mercado não são informados pelo provedor.'}};
    }
    if(route==='/inventory/batch'&&method==='POST')return {status:201,data:await createBatch(userId,data)};
    if(route==='/inventory/bulk'&&method==='POST')return {status:200,data:await bulk(userId,data)};
    if(route==='/inventory/events'&&method==='GET')return {status:200,data:await events(userId,query)};
    const match=route.match(/^\/inventory\/([-\w]+)$/);if(!match)return null;
    if(method==='GET'){const row=await owned(userId,match[1]),[item]=await enrichMarket([dto(row,await prices(userId))],{maxRefresh:1});return {status:200,data:{item,events:(await events(userId,new URLSearchParams({itemId:row.id,pageSize:'60'}))).items}};}
    if(method==='PUT')return {status:200,data:await edit(userId,match[1],data)};
    if(method==='DELETE')return {status:200,data:await remove(userId,match[1],data)};
    return null;
  }
  return {handle,list,stats,createBatch,bulk,edit,remove,describe:dto};
}
module.exports={createPersonalInventory,collectionMetrics,safeImageUrl,LANGUAGES,CONDITIONS,VARIANTS,ATTRIBUTES,ITEM_TYPES};
