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
  return queue.reduce((sum,item)=>{const quantity=item.quantity||1;sum.quantity+=quantity;if(item.paidCents==null)sum.unknownCost+=quantity;else sum.knownCost+=item.paidCents*quantity;if(item.manualValueCents==null&&!item.valuation)sum.unpriced+=quantity;return sum;},{quantity:0,knownCost:0,unknownCost:0,unpriced:0});
}
// International references remain in their native currency. Missing condition /
// language coverage must never become an exact appraisal or a BRL profit input.
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
