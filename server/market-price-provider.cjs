const crypto=require('node:crypto');
const {parsePersonalCsv}=require('./personal-csv.cjs');
const LANGUAGES=['pt','en','ja','fr','de','es','it','ko','zh-tw','zh-cn','id','th'];
const CONDITIONS=['NM','LP','MP','HP','DMG'],VARIANTS=['NORMAL','HOLO','REVERSE','PROMO','FIRST_EDITION','OTHER'];
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
class MarketPriceError extends Error {constructor(code,message){super(message);this.code=code;}}
class MarketPriceProvider {
  async getQuote() {throw new MarketPriceError('PRICE_PROVIDER_UNAVAILABLE','Nenhum provedor autorizado está configurado.');}
}
function quoteDto(row,now,ttlDays) {return {id:row.id,cardId:row.card_id,setId:row.set_id,language:row.language,condition:row.condition,variant:row.variant,valueCents:row.value_cents,currency:'BRL',source:'admin_manual',sourceLabel:row.source_label,sourceUrl:row.source_url,methodology:'manual',observations:null,coverage:'manual_authorized',quotedAt:row.quoted_at,recordedAt:row.recorded_at,rightsConfirmed:row.rights_confirmed===1,stale:now-Date.parse(row.quoted_at)>ttlDays*86400000,manual:true};}
class ManualAuthorizedPriceProvider extends MarketPriceProvider {
  constructor({db,now=Date.now,ttlDays=7}) {super();if(!Number.isInteger(ttlDays)||ttlDays<1||ttlDays>365)throw new MarketPriceError('PRICE_TTL_INVALID','TTL deve ter entre 1 e 365 dias.');Object.assign(this,{db,now,ttlDays,authorized:true,id:'admin_manual',automated:false});}
  async getQuote({card,language,condition='NM',variant='NORMAL',currency='BRL'}={}) {
    if(currency!=='BRL')throw new MarketPriceError('PRICE_CURRENCY_UNSUPPORTED','Não há conversão presumida de preços estrangeiros.');
    if(!card?.id||!card.setId||!LANGUAGES.includes(language)||!CONDITIONS.includes(condition)||!VARIANTS.includes(variant)||card.language&&card.language!==language)return null;
    const row=await this.db.prepare("SELECT * FROM market_quotes WHERE card_id=? AND set_id=? AND language=? AND condition=? AND variant=? AND currency='BRL' AND rights_confirmed=1 ORDER BY quoted_at DESC,recorded_at DESC,id DESC LIMIT 1").get(card.id,card.setId,language,condition,variant);
    return row?quoteDto(row,this.now(),this.ttlDays):null;
  }
  async getQuotes(items=[]) {
    if(!Array.isArray(items)||items.length>10000)throw new MarketPriceError('PRICE_BATCH_INVALID','Consulte até 10.000 identidades por vez.');
    const key=value=>[value.cardId,value.setId,value.language,value.condition,value.variant].join('|'),eligible=items.filter(item=>item&&typeof item.cardId==='string'&&typeof item.setId==='string'&&LANGUAGES.includes(item.language)&&CONDITIONS.includes(item.condition)&&VARIANTS.includes(item.variant)),wanted=new Set(eligible.map(key)),ids=[...new Set(eligible.map(item=>item.cardId))],result=[];
    for(let offset=0;offset<ids.length;offset+=500){
      const chunk=ids.slice(offset,offset+500),rows=await this.db.prepare("SELECT * FROM (SELECT market_quotes.*,ROW_NUMBER() OVER(PARTITION BY card_id,set_id,language,condition,variant ORDER BY quoted_at DESC,recorded_at DESC,id DESC) AS quote_rank FROM market_quotes WHERE card_id IN ("+chunk.map(()=>'?').join(',')+") AND currency='BRL' AND rights_confirmed=1) ranked WHERE quote_rank=1").all(...chunk);
      for(const row of rows){const quote=quoteDto(row,this.now(),this.ttlDays);if(wanted.has(key(quote)))result.push(quote);}
    }
    return result;
  }
}

function createMarketPriceService({db,ApiError,now=Date.now,ttlDays=7}) {
  const provider=new ManualAuthorizedPriceProvider({db,now,ttlDays}),stamp=()=>new Date(now()).toISOString();
  const fail=(message,code='VALIDATION',status=422)=>{throw new ApiError(status,code,message);};
  async function requireAdmin(user) {if(!user?.id)fail('Entre como administrador.','AUTH_REQUIRED',401);const current=await db.prepare('SELECT role FROM users WHERE id=?').get(user.id);if(current?.role!=='ADMIN')fail('Acesso reservado à administração.','FORBIDDEN',403);return user.id;}
  function validatePrice(row,data) {
    const cardId=String(row.cardId||''),setId=String(row.setId||''),language=row.language||'pt',condition=row.condition||'NM',variant=row.variant||'NORMAL',valueCents=typeof row.valueCents==='string'&&row.valueCents.trim()!==''?Number(row.valueCents):row.valueCents;
    if(!/^[a-zA-Z0-9.+_-]{1,80}$/.test(setId)||!cardId.startsWith(setId+'-')||!/^[a-zA-Z0-9.+_-]{1,180}$/.test(cardId)||!LANGUAGES.includes(language)||!CONDITIONS.includes(condition)||!VARIANTS.includes(variant))fail('Identidade, idioma, condição ou variante inválida.');
    if(row.currency!=='BRL')fail('Informe currency=BRL explicitamente. Preços USD/EUR não são convertidos.');
    if(!Number.isSafeInteger(valueCents)||valueCents<0||valueCents>100000000)fail('valueCents deve ser um inteiro de 0 a 100.000.000.');
    if(row.methodology&&row.methodology!=='manual')fail('Esta fonte aceita apenas metodologia manual; não declare mediana ou vendas concluídas.');
    const sourceLabel=String(row.sourceLabel||data.sourceLabel||'').trim(),sourceUrl=String(row.sourceUrl||data.sourceUrl||'').trim();
    if(!sourceLabel||sourceLabel.length>200)fail('Informe uma fonte identificável com até 200 caracteres.');
    let url;try{url=new URL(sourceUrl);}catch{fail('Informe a URL HTTPS da fonte.');}
    if(url.protocol!=='https:'||url.username||url.password||sourceUrl.length>2000)fail('Informe uma URL HTTPS da fonte sem credenciais.');
    const date=new Date(row.quotedAt||data.quotedAt||'');if(!Number.isFinite(date.getTime())||date.getTime()>now()+60000)fail('Informe data válida da cotação, sem data futura.');
    return {cardId,setId,language,condition,variant,valueCents,currency:'BRL',source:'admin_manual',sourceLabel,sourceUrl:url.href,methodology:'manual',quotedAt:date.toISOString(),line:row.line};
  }
  const providers=()=>[
    {id:'admin_manual',name:'Referências manuais autorizadas',configured:true,currency:'BRL',automated:false,methodology:'manual',ttlDays,notice:'Valores inseridos pela administração mediante confirmação dos direitos de uso. Não são cotações oficiais da Liga Pokémon.'},
    {id:'ligapokemon',name:'Liga Pokémon',configured:false,currency:'BRL',automated:false,reason:'Sem API, licença ou parceria autorizada configurada. Nenhuma extração automatizada é realizada.'}
  ];
  function pagination(query){return {page:Math.max(1,Math.min(10000,parseInt(query.get('page')||'1',10)||1)),pageSize:Math.max(1,Math.min(100,parseInt(query.get('pageSize')||'30',10)||30))};}
  async function list(query) {
    const where=[],args=[];for(const [parameter,column]of[['cardId','card_id'],['setId','set_id'],['language','language'],['condition','condition'],['variant','variant']])if(query.get(parameter)){where.push(column+'=?');args.push(query.get(parameter));}
    const sql=where.length?' WHERE '+where.join(' AND '):'',{page,pageSize}=pagination(query),total=(await db.prepare('SELECT COUNT(*) count FROM market_quotes'+sql).get(...args)).count;
    const rows=await db.prepare('SELECT * FROM market_quotes'+sql+' ORDER BY recorded_at DESC,id DESC LIMIT ? OFFSET ?').all(...args,pageSize,(page-1)*pageSize);
    return {providers:providers(),items:rows.map(row=>quoteDto(row,now(),ttlDays)),total,page,pageSize};
  }
  async function preview(userId,data) {
    const parsed=parsePersonalCsv(data.csv),rows=[],errors=[...parsed.errors],duplicates=[],seen=new Map();
    for(const row of parsed.rows){try{const value=validatePrice(row,data),key=JSON.stringify([value.cardId,value.setId,value.language,value.condition,value.variant,value.sourceLabel,value.sourceUrl,value.quotedAt]);if(seen.has(key)){const prior=seen.get(key);if(prior.valueCents!==value.valueCents)errors.push({line:row.line,message:'Preços conflitantes para a mesma carta, fonte e data.'});else duplicates.push({line:row.line,previousLine:prior.line});}else seen.set(key,value);rows.push(value);}catch(error){errors.push({line:row.line,message:error.status?error.message:'Cotação inválida.'});}}
    await db.prepare('DELETE FROM market_imports WHERE user_id=? AND expires_at<?').run(userId,now());
    if((await db.prepare("SELECT COUNT(*) count FROM market_imports WHERE user_id=? AND status='PENDING'").get(userId)).count>=5)fail('Há cinco prévias pendentes. Aguarde a expiração.');
    const token=crypto.randomBytes(32).toString('base64url'),expiresAt=now()+30*60000;
    await db.prepare("INSERT INTO market_imports(id,user_id,token_hash,rows_json,errors_json,expires_at,status,created_at) VALUES(?,?,?,?,?,?,'PENDING',?)").run(crypto.randomUUID(),userId,hash(token),JSON.stringify(rows),JSON.stringify(errors),expiresAt,stamp());
    return {token,rows,errors,duplicates,canConfirm:rows.length>0&&errors.length===0,expiresAt:new Date(expiresAt).toISOString(),notice:'A confirmação declara que os dados foram obtidos legitimamente. Esta importação não consulta sites nem converte moedas.'};
  }
  async function confirm(userId,data) {
    if(typeof data.token!=='string'||data.token.length>100)fail('Token de importação inválido.');
    if(data.rightsConfirmed!==true)fail('Confirme que possui autorização para utilizar esses dados.','PRICE_RIGHTS_REQUIRED');
    return db.transaction(async()=>{
      const item=await db.prepare('SELECT * FROM market_imports WHERE token_hash=? AND user_id=?'+db.lockSuffix).get(hash(data.token),userId);
      if(!item)fail('Prévia não encontrada.','NOT_FOUND',404);
      if(item.status==='CONFIRMED')return JSON.parse(item.result_json);
      if(item.expires_at<now())fail('Prévia expirada. Importe novamente.','IMPORT_EXPIRED',410);
      const rows=JSON.parse(item.rows_json),errors=JSON.parse(item.errors_json);if(errors.length||!rows.length)fail('Corrija as linhas inválidas antes de confirmar.');
      const time=stamp(),unique=new Map();
      for(const row of rows){const key=hash(JSON.stringify([row.cardId,row.setId,row.language,row.condition,row.variant,row.valueCents,row.currency,row.sourceLabel,row.sourceUrl,row.methodology,row.quotedAt]));if(!unique.has(key))unique.set(key,{...row,id:crypto.randomUUID(),key});}
      const columns=['id','quote_key','card_id','set_id','language','condition','variant','value_cents','currency','source','source_label','source_url','methodology','quoted_at','recorded_at','publisher_id','rights_confirmed'];
      const records=[...unique.values()].map(row=>({id:row.id,quote_key:row.key,card_id:row.cardId,set_id:row.setId,language:row.language,condition:row.condition,variant:row.variant,value_cents:row.valueCents,currency:'BRL',source:'admin_manual',source_label:row.sourceLabel,source_url:row.sourceUrl,methodology:'manual',quoted_at:row.quotedAt,recorded_at:time,publisher_id:userId,rights_confirmed:1}));
      let created=0;
      for(let offset=0;offset<records.length;offset+=50){const chunk=records.slice(offset,offset+50),result=await db.prepare('INSERT INTO market_quotes('+columns.join(',')+') VALUES '+chunk.map(()=> '('+columns.map(()=>'?').join(',')+')').join(',')+' ON CONFLICT(quote_key) DO NOTHING').run(...chunk.flatMap(row=>columns.map(column=>row[column])));created+=result.changes;}
      const keys=[...unique.keys()],saved=await db.prepare('SELECT id FROM market_quotes WHERE quote_key IN ('+keys.map(()=>'?').join(',')+')').all(...keys),result={imported:rows.length,created,quoteIds:saved.map(row=>row.id),source:'admin_manual'};
      await db.prepare("UPDATE market_imports SET status='CONFIRMED',result_json=? WHERE id=? AND user_id=?").run(JSON.stringify(result),item.id,userId);
      return result;
    });
  }
  async function handleAdmin(context) {
    const base='/api/admin/market-prices',path=context.path||context.pathname||'';if(path!==base&&!path.startsWith(base+'/'))return null;
    const userId=await requireAdmin(context.user),route=path.slice(base.length),method=context.method||'GET',query=context.query instanceof URLSearchParams?context.query:new URLSearchParams(context.query||{}),body=context.body||{};
    if(method==='GET'&&(route===''||route==='/providers'))return {status:200,data:await list(query)};
    if(method==='POST'&&route==='/import/preview')return {status:201,data:await preview(userId,body)};
    if(method==='POST'&&route==='/import/confirm')return {status:201,data:await confirm(userId,body)};
    fail('Recurso de referências de preço não encontrado.','NOT_FOUND',404);
  }
  return {provider,handleAdmin};
}
module.exports={MarketPriceProvider,ManualAuthorizedPriceProvider,MarketPriceError,createMarketPriceService};
