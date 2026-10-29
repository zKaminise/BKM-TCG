'use strict';
const crypto=require('node:crypto');
const {hashToken}=require('./auth.cjs');
const {createCollectionCatalog}=require('./collection-catalog.cjs');
function createProductWorkflow({db,ApiError,fetchImpl,audit,now=Date.now}){
  const catalog=createCollectionCatalog({db,ApiError,fetchImpl});
  const fail=(status,code,message)=>{throw new ApiError(status,code,message);};
  function referenceLanguage(value='pt'){const lang=value==='pt-br'?'pt':value;if(!['pt','en','ja','fr','de','es','it','ko','zh-tw','zh-cn','id','th'].includes(lang))fail(422,'VALIDATION','Escolha um idioma de catálogo válido.');return lang;}
  async function grant(query,user,session,reason){
    const q=String(query.get('q')||'').trim();if(!q||q.length>160)fail(422,'VALIDATION','Pesquise a identificação da carta antes de abrir o cadastro manual.');
    const language=referenceLanguage(query.get('language')||'pt'),setId=query.get('setId')||'',token=crypto.randomBytes(32).toString('base64url'),expiresAt=now()+15*60000;
    await db.prepare('DELETE FROM admin_catalog_fallbacks WHERE expires_at<?').run(now()-86400000);
    await db.prepare('INSERT INTO admin_catalog_fallbacks(token_hash,user_id,session_hash,query,language,set_id,reason,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(hashToken(token),user.id,session.token_hash,q,language,setId,reason,expiresAt,new Date(now()).toISOString());
    return {token,reason,expiresAt};
  }
  async function search(query,user,session){
    try{const result=await catalog.search(query);if(result.total===0&&String(query.get('q')||'').trim())result.manualFallback=await grant(query,user,session,'not_found');return result;}
    catch(error){if(error.status>=500||error.status===404){const manualFallback=await grant(query,user,session,error.status===404?'not_found':'unavailable');error.fields={...error.fields,manualFallback};}throw error;}
  }
  async function manualFallback(body,user,session){
    const q=typeof body.q==='string'?body.q.trim():'';if(!q)fail(422,'VALIDATION','Informe o nome ou número da carta que não foi encontrada.');
    const query=new URLSearchParams({q,language:body.language||'pt',live:'1',pageSize:'1'});if(body.setId)query.set('setId',body.setId);
    try{const result=await search(query,user,session);if(result.manualFallback)return result.manualFallback;fail(409,'CATALOG_MATCH_FOUND','Encontramos cartas para esta pesquisa. Selecione a referência do catálogo ou refine a busca antes de cadastrar manualmente.');}
    catch(error){if(error.fields?.manualFallback)return error.fields.manualFallback;throw error;}
  }
  async function resolve(data,existing,actor,session){
    if(data.kind!=='SINGLE')return {data};
    const old=existing?.card_id?(await db.prepare('SELECT metadata_json FROM card_metadata WHERE id=?').get(existing.card_id)):null,previous=old?JSON.parse(old.metadata_json):null;
    const selection=data.catalogSelection||((String(data.card?.provider||'').toLowerCase()==='tcgdex')?{language:data.card.language,cardId:data.card.providerId,setId:data.setId}:null);
    if(selection){
      const language=selection.language||'pt',cardId=selection.cardId,setId=selection.setId;
      let card;
      try{card=await catalog.card(cardId,setId,language);}
      catch(error){
        const same=previous&&String(previous.provider).toLowerCase()==='tcgdex'&&previous.providerId===cardId&&previous.language===language&&existing.set_id===setId;
        if(!same||error.status<500)throw error;
        // A provider outage must not let client-supplied metadata replace an
        // already verified identity, or prevent an existing stock-only edit.
        return {data:{...data,name:existing.name,setId:existing.set_id,setName:existing.set_name,tcg:existing.tcg,card:previous,images:JSON.parse(existing.images_json)}};
      }
      // Keep the administrator's gallery order (and therefore cover photo),
      // while allowing only the verified reference plus actual product photos.
      let referenceAdded=false;
      const images=(Array.isArray(data.images)?data.images:[]).flatMap(image=>{
        if(image?.kind==='actual')return [image];
        if(!referenceAdded&&card.image&&image?.url===card.image){referenceAdded=true;return [{url:card.image,kind:'reference',alt:`${card.name} · ${card.displayNumber}`}];}
        return [];
      });
      if(card.image&&!referenceAdded)images.unshift({url:card.image,kind:'reference',alt:`${card.name} · ${card.displayNumber}`});
      const metadata={name:card.name,number:card.number,total:card.total,rarity:card.rarity,type:card.types||[],hp:card.hp||null,provider:'tcgdex',providerId:card.providerId,language:card.referenceLanguage,displayNumber:card.displayNumber,referenceImage:card.image,referenceLanguage:card.referenceLanguage};
      return {data:{...data,name:card.name,setId:card.setId,setName:card.setName,tcg:'pokemon',card:metadata,images}};
    }
    // Existing manual listings may be edited without manufacturing another
    // lookup failure. New manual identities require a session-bound proof.
    const legacyManual=previous&&String(previous.provider).toLowerCase()==='manual'&&data.kind===existing.kind&&(!data.setId||data.setId===existing.set_id)&&String(data.card?.number||'').trim()===String(previous.number).trim()&&(!data.card?.language||data.card.language===previous.language);
    const token=data.manualFallbackToken;
    let fallback;
    if(!legacyManual){
      if(typeof token!=='string'||!/^[-_A-Za-z0-9]{43}$/.test(token))fail(422,'MANUAL_LOOKUP_REQUIRED','Pesquise a carta. O cadastro manual é liberado quando ela não é encontrada ou o catálogo está indisponível.');
      fallback=await db.prepare('SELECT * FROM admin_catalog_fallbacks WHERE token_hash=?').get(hashToken(token));
      if(!fallback||fallback.user_id!==actor||fallback.session_hash!==session?.token_hash||fallback.expires_at<=now()||fallback.used_at)fail(422,'MANUAL_LOOKUP_EXPIRED','A autorização do cadastro manual expirou ou já foi utilizada. Faça a pesquisa novamente.');
    }
    const cleanAttributes={...data.attributes};delete cleanAttributes.manualCatalogFallback;
    const preservedProof=legacyManual?JSON.parse(existing.attributes_json||'{}').manualCatalogFallback:null;
    const setName=typeof data.setName==='string'?data.setName.trim():'',manualId='manual-'+(setName.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,75)||crypto.createHash('sha256').update(setName).digest('hex').slice(0,16));
    if(!setName)fail(422,'VALIDATION','Informe a coleção impressa na carta para continuar o cadastro manual.');
    return {data:{...data,setId:data.setId||manualId,card:{...data.card,provider:'manual',providerId:'',language:data.card?.language||fallback?.language||previous?.language||'pt'},attributes:{...cleanAttributes,...fallback?{manualCatalogFallback:{query:fallback.query,language:fallback.language,reason:fallback.reason,checkedAt:fallback.created_at}}:preservedProof?{manualCatalogFallback:preservedProof}:{}}},fallback};
  }
  async function consume(fallback,actor,session){
    if(!fallback)return;
    const row=await db.prepare('SELECT * FROM admin_catalog_fallbacks WHERE token_hash=?'+db.lockSuffix).get(fallback.token_hash);
    if(!row||row.user_id!==actor||row.session_hash!==session?.token_hash||row.expires_at<=now()||row.used_at)fail(422,'MANUAL_LOOKUP_EXPIRED','A autorização do cadastro manual expirou ou já foi utilizada. Faça a pesquisa novamente.');
    await db.prepare('UPDATE admin_catalog_fallbacks SET used_at=? WHERE token_hash=?').run(new Date(now()).toISOString(),fallback.token_hash);
  }
  async function allocate(p){
    await db.prepare('INSERT INTO product_sequences(id,next_number) VALUES(1,1) ON CONFLICT(id) DO NOTHING').run();
    const sequence=await db.prepare('SELECT next_number FROM product_sequences WHERE id=1'+db.lockSuffix).get();
    if(!p.sku){
      let number=Number(sequence.next_number);const rows=await db.prepare("SELECT sku FROM products WHERE upper(sku) LIKE 'BKM%'").all();
      for(const row of rows){const match=/^BKM([1-9]\d*)$/i.exec(row.sku);if(match&&Number.isSafeInteger(Number(match[1])))number=Math.max(number,Number(match[1])+1);}
      if(!Number.isSafeInteger(number)||number<1||number>=2147483647)fail(409,'SKU_SEQUENCE_LIMIT','A sequência de SKUs precisa de revisão administrativa.');
      p.sku='BKM'+number;await db.prepare('UPDATE product_sequences SET next_number=? WHERE id=1').run(number+1);
    }
    if(!p.slug){
      const base=p.name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,160)||'produto';let slug=base,offset=1;
      while(await db.prepare('SELECT id FROM products WHERE slug=?').get(slug)){offset++;slug=base+'-'+offset;}
      p.slug=slug;
    }
  }
  return {catalog,sets:value=>catalog.sets(referenceLanguage(value)),search,manualFallback,resolve,consume,allocate};
}
module.exports={createProductWorkflow};
