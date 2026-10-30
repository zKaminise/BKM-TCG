// Exact, nullable money and draft helpers shared by the collection screens.
export const COLLECTION_LANGUAGES = [["pt","Português (Brasil)"],["en","Inglês"],["ja","Japonês"],["zh-tw","Chinês tradicional"],["zh-cn","Chinês simplificado"],["ko","Coreano"],["es","Espanhol"],["fr","Francês"],["de","Alemão"],["it","Italiano"],["th","Tailandês"],["id","Indonésio"]];
export const COLLECTION_CONDITIONS = [["M","Mint"],["NM","Near Mint"],["SP","Slightly Played"],["MP","Moderately Played"],["HP","Heavily Played"],["D","Damaged"]];
export const COLLECTION_TYPES = [["SINGLE","Carta avulsa"],["BOOSTER","Booster"],["BLISTER","Blister"],["DECK","Deck"],["ETB","Elite Trainer Box / ETB"],["BOX","Box"],["TIN","Lata"],["ACCESSORY","Acessório"],["CUSTOM","Colecionável / personalizado"]];
export const COLLECTION_FINISHES = [["NORMAL","Normal"],["HOLO","Holo"],["REVERSE","Reverse"],["POKE_BALL","Poké Ball"],["MASTER_BALL","Master Ball"],["OTHER","Outro"]];
export const COLLECTION_ATTRIBUTES = [["PROMO","Promo"],["STAMP","Carimbo / stamp"],["FIRST_EDITION","1ª edição"],["SPECIAL_EDITION","Edição especial"]];
export const COLLECTION_STATUS = {IN_COLLECTION:"Em coleção",FOR_SALE:"Disponível para venda",SOLD:"Vendido / saída registrada",ARCHIVED:"Arquivado"};
export function parseCollectionMoney(value) {
  if (value == null || String(value).trim() === "") return null;
  let text=String(value).trim().replace(/^R\$\s*/i,"").replace(/\s/g,"");
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(text)) text=text.replace(/\./g,"").replace(",",".");
  else if (/^\d+(?:,\d{1,2})?$/.test(text)) text=text.replace(",",".");
  else if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error("Informe um valor como 150 ou 150,50, sem sinal negativo.");
  const [whole,fraction=""]=text.split("."),cents=Number(whole)*100+Number(fraction.padEnd(2,"0"));
  if(!Number.isSafeInteger(cents)||cents>100000000)throw new Error("Use um valor de até R$ 1.000.000,00.");
  return cents;
}
export function collectionDecimal(cents) {return cents==null?"":`${Math.floor(cents/100)},${String(cents%100).padStart(2,"0")}`;}
export function collectionDate(value) {return /^\d{4}-\d{2}-\d{2}$/.test(value||"")?value.split("-").reverse().join("/"):"Não informada";}
export function collectionCopyAcquisition(queue,index,{overwrite=false}={}) {
  const fields=["paidCents","acquiredAt","condition","language","variant","attributes"],source=queue[index];
  return queue.map((item,i)=>{
    if(i<=index)return structuredClone(item);
    const next=structuredClone(item);next.touched={...next.touched};
    for(const field of fields){if((overwrite||!item.touched?.[field])&&((field!=="condition"&&field!=="variant"&&field!=="attributes")||item.kind===source.kind)){next[field]=structuredClone(source[field]??null);next.touched[field]=true;}}
    return next;
  });
}
export function collectionBatchPayload(queue,requestId) {
  return {requestId,items:queue.map(item=>({kind:item.kind,cardId:item.kind==='CARD'?item.cardId||undefined:undefined,setId:item.setId||undefined,setName:item.card?.setName||item.setName||"",sealedId:item.sealedId||item.card?.sealedId||undefined,referenceLanguage:item.referenceLanguage||item.card?.language||"pt",language:item.language||"pt",condition:item.condition,variant:item.variant||"NORMAL",attributes:item.attributes||[],quantity:item.quantity||1,paidCents:item.paidCents??null,acquiredAt:item.acquiredAt||null,notes:item.notes||"",photoUrl:item.photoUrl||"",manualValueCents:item.manualValueCents??null,title:item.title||item.card?.name||"",description:item.description||item.card?.description||"",itemType:item.itemType|| (item.kind==="CARD"?"SINGLE":item.kind==='SEALED'?'BOOSTER':"CUSTOM")}))};
}
export function collectionQueueTotals(queue) {
  return queue.reduce((sum,item)=>{const quantity=item.quantity||1;sum.quantity+=quantity;if(item.paidCents==null)sum.unknownCost+=quantity;else sum.knownCost+=item.paidCents*quantity;const quote=item.valuation,manual=Number.isSafeInteger(item.manualValueCents)&&item.manualValueCents>=0,exact=quote&&!quote.stale&&!quote.fxConverted&&quote.currency==='BRL'&&quote.source!=='mypcards'&&Number.isSafeInteger(quote.valueCents);if(!manual&&!exact&&!collectionBrazilian(item).usable&&!collectionConverted(item).usable)sum.unpriced+=quantity;return sum;},{quantity:0,knownCost:0,unknownCost:0,unpriced:0});
}
// MYP identifies a printing, while its public prices aggregate PT/EN offers,
// conditions and finishes. Recheck a changed wizard language/finish locally.
export function collectionBrazilian(item={},now=Date.now()) {
  const reference=item.brazilianMarket||item.card?.brazilianMarket||null;
  const cardId=item.cardId||item.providerId||item.card?.providerId||item.card?.id||item.id,setId=item.setId||item.card?.setId;
  const language=item.language||item.referenceLanguage||item.card?.referenceLanguage||item.card?.language||'pt',referenceLanguage=item.referenceLanguage||item.card?.referenceLanguage||item.card?.language||language;
  const result={reference:null,hasPrices:false,usable:false,stale:false,unavailableReason:'Sem referência brasileira disponível para esta carta.'};
  if((item.kind&&item.kind!=='CARD')||!['pt','en'].includes(language)||language!==referenceLanguage)return {...result,unavailableReason:'Sem referência brasileira compatível com o idioma físico deste exemplar.'};
  if(!reference||reference.source!=='mypcards'||reference.currency!=='BRL'||reference.match!=='PRINTING_EXACT'||reference.cardId!==cardId||reference.setId!==setId||reference.referenceLanguage!==referenceLanguage)return result;
  const observed=Date.parse(reference.fetchedAt),expires=Date.parse(reference.expiresAt),positive=value=>Number.isSafeInteger(value)&&value>0&&value<=100000000;
  if(!Number.isFinite(observed)||observed>now)return result;
  const stale=!!reference.stale||!Number.isFinite(expires)||expires<=now||now-observed>=86400000,hasPrices=positive(reference.minPriceCents)||positive(reference.avgPriceCents),ordinary=!(item.attributes||[]).length&&['NORMAL','HOLO','REVERSE'].includes(item.variant||'NORMAL');
  const usable=reference.status==='MATCHED'&&!stale&&hasPrices&&positive(reference.avgPriceCents)&&ordinary;
  return {reference,hasPrices,usable,stale,unavailableReason:!ordinary?'Acabamento ou atributos especiais sem correspondência brasileira específica.':stale?'Referência brasileira desatualizada; não incluída no total estimado.':!hasPrices?'Sem anúncios com preço em PT/EN para esta impressão.':!positive(reference.avgPriceCents)?'Preço médio não disponível; referência fora do total estimado.':reference.status!=='MATCHED'?'Referência brasileira temporariamente indisponível.':null};
}
// Recheck converted estimates after the wizard changes a physical language,
// finish or attributes. A conversion never creates an exact-condition price.
export function collectionConverted(item={},now=Date.now()) {
  const variant=item.variant||'NORMAL',byVariant=item.convertedInternationalByVariant;
  // An inventory DTO's current value (including explicit null) overrides the
  // older catalogue snapshot saved inside card. Wizard-only cards use its map.
  const reference=byVariant&&Object.hasOwn(byVariant,variant)?byVariant[variant]:Object.hasOwn(item,'convertedInternational')?item.convertedInternational:item.card?.convertedInternationalByVariant?.[variant]||item.card?.convertedInternational||null;
  const result={reference:null,usable:false,unavailableReason:'Estimativa em reais indisponível. É necessária uma referência internacional atual e uma cotação de câmbio válida.'};
  const cardId=item.cardId||item.providerId||item.card?.providerId||item.card?.id||item.id,setId=item.setId||item.card?.setId;
  const language=item.language||item.referenceLanguage||item.card?.referenceLanguage||item.card?.language||'pt',referenceLanguage=item.referenceLanguage||item.card?.referenceLanguage||item.card?.language||language;
  if((item.kind&&item.kind!=='CARD')||language!==referenceLanguage)return {...result,unavailableReason:'Sem estimativa em reais compatível com o idioma físico deste exemplar.'};
  if(!['NORMAL','HOLO','REVERSE'].includes(variant)||(item.attributes||[]).length)return {...result,unavailableReason:'Acabamento ou atributos especiais sem referência correspondente para conversão.'};
  if(!reference||reference.source!=='international_fx'||reference.currency!=='BRL'||reference.fxConverted!==true||reference.converted!==true||reference.match!=='PARTIAL'||reference.usableForBrlValuation!==true||reference.conditionAdjusted!==false||reference.cardId!==cardId||reference.setId!==setId||reference.referenceLanguage!==referenceLanguage||reference.language!==language||reference.variant!==variant)return result;
  const rate=reference.exchangeRate,positive=value=>Number.isSafeInteger(value)&&value>0&&value<=100000000;
  const original=Date.parse(reference.quotedAt),fetched=Date.parse(reference.fetchedAt),expires=Date.parse(reference.expiresAt),rateAt=Date.parse(rate?.quotedAt),rateFetched=Date.parse(rate?.fetchedAt),rateExpires=Date.parse(rate?.expiresAt);
  if(reference.stale||!positive(reference.valueCents)||!positive(reference.originalValueCents)||!['EUR','USD'].includes(reference.originalCurrency)||!['cardmarket','tcgplayer'].includes(reference.originalSource)||({cardmarket:'EUR',tcgplayer:'USD'})[reference.originalSource]!==reference.originalCurrency||rate?.source!=='bcb_ptax'||rate.currency!==reference.originalCurrency||rate.targetCurrency!=='BRL'||!Number.isSafeInteger(rate.rateMicros)||rate.rateMicros<=0||rate.rateMicros>1000000000||rate.stale||![original,fetched,expires,rateAt,rateFetched,rateExpires].every(Number.isFinite)||original>now||fetched>now||rateAt>now||rateFetched>now||now-original>=7*86400000||now-rateAt>=7*86400000||expires<=now||rateExpires<=now)return result;
  const expected=Number((BigInt(reference.originalValueCents)*BigInt(rate.rateMicros)+500000n)/1000000n);
  if(reference.valueCents!==expected)return result;
  return {reference,usable:true,unavailableReason:null};
}
export function collectionQuoteDateTime(value) {
  const time=Date.parse(value);return Number.isFinite(time)?new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(time):'Data de consulta indisponível';
}
// Native references retain their original source amount. A separately identified
// FX estimate can be shown in BRL without claiming a Brazilian market appraisal.
export function collectionInternational(item={},now=Date.now()) {
  const data=item.marketData||item.card?.marketData,finish=item.variant||'NORMAL',attributes=item.attributes||[];
  const references=(data?.references||[]).map(quote=>({...quote,stale:!!quote.stale||!Number.isFinite(Date.parse(quote.quotedAt))||now-Date.parse(quote.quotedAt)>7*86400000}));
  const supported=!attributes.length&&(!data?.knownFinishes?.length||data.knownFinishes.includes(finish));
  const compatible=references.filter(quote=>supported&&quote.variant===finish).sort((a,b)=>Number(b.finishBasis==='provider_holo_field')-Number(a.finishBasis==='provider_holo_field'));
  const current=compatible.filter(quote=>!quote.stale),selected=current.find(quote=>quote.source==='tcgplayer')||current[0]||null;
  return {references,compatible,current,selected,finishSupported:supported,conditionMatched:false,languageMatched:false,notice:data?.notice||'Sem referência internacional disponível.',unavailableReason:attributes.length?'Atributos especiais sem referência correspondente.':!supported?'Acabamento informado sem referência correspondente.':!selected?'Sem referência internacional atual para este acabamento.':null};
}
export function collectionForeignMoney(value,currency) {
  if(!['USD','EUR'].includes(currency)||!Number.isSafeInteger(value)||value<0)return 'Indisponível';
  return new Intl.NumberFormat('pt-BR',{style:'currency',currency}).format(value/100);
}
export function createCollectionSearchScheduler(search,{delay=250,setTimer=setTimeout,clearTimer=clearTimeout}={}) {
  let timer=null,disposed=false;
  return {schedule(){if(disposed)return;clearTimer(timer);timer=setTimer(()=>{timer=null;if(!disposed)search();},delay);},flush(){if(disposed)return;clearTimer(timer);timer=null;return search();},cancel(){clearTimer(timer);timer=null;},dispose(){disposed=true;clearTimer(timer);timer=null;}};
}
export function collectionDraftKey(userId) {if(!userId)throw new Error("Uma sessão é necessária para o rascunho.");return `bkm:collection-draft:v2:${userId}`;}
export function collectionCostMutation({ids,costTouched=false,paidCents=null,mode="unit",changeDate=false,acquiredAt=null}) {
  if(!costTouched&&!changeDate)throw new Error("Informe um custo, use Não informar ou escolha alterar a data de aquisição.");
  const payload={action:"cost",ids:[...ids]};
  if(costTouched){
    if(paidCents!==null&&(!Number.isSafeInteger(paidCents)||paidCents<0||paidCents>100000000))throw new Error("Custo de aquisição inválido.");
    if(!["unit","total"].includes(mode))throw new Error("Escolha como aplicar o custo.");
    payload.paidCents=paidCents;payload.mode=mode;
  }
  if(changeDate)payload.acquiredAt=acquiredAt||null;
  return payload;
}
