'use strict';

// TCGdex exposes international marketplace references, not Brazilian quotes or
// conservation-specific appraisals. These values never enter BRL profit math.
const DAY=86400000;
const FINISHES={normal:'NORMAL',holo:'HOLO',holofoil:'HOLO',reverse:'REVERSE','reverse-holofoil':'REVERSE'};
function minorUnits(value){
  if(typeof value!=='number'&&typeof value!=='string')return null;
  const text=String(value);if(!/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(text))return null;
  const [whole,fraction='']=text.split('.'),amount=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  return Number.isSafeInteger(amount)&&amount>0&&amount<=100000000?amount:null;
}
function timestamp(value,now){const time=Date.parse(value);return typeof value==='string'&&Number.isFinite(time)&&time<=now+60000?new Date(time).toISOString():null;}
function normalizeTcgdexMarket(raw,{language='pt',fetchedAt,now=Date.now()}={}){
  const references=[],pricing=raw?.pricing,cardId=String(raw?.id||''),setId=String(raw?.set?.id||cardId.slice(0,cardId.lastIndexOf('-'))||'');
  const sourceUrl=/^[a-zA-Z0-9.+_-]{1,180}$/.test(cardId)&&/^[a-z-]{2,8}$/.test(language)?`https://api.tcgdex.net/v2/${language}/cards/${encodeURIComponent(cardId)}`:'';
  const knownFinishes=Object.entries({NORMAL:raw?.variants?.normal,HOLO:raw?.variants?.holo,REVERSE:raw?.variants?.reverse}).filter(([,enabled])=>enabled===true).map(([finish])=>finish);
  const add=(provider,record,field,variant,extra={})=>{
    const valueCents=minorUnits(record?.[field]),quotedAt=timestamp(record?.updated,now);
    if(valueCents===null||!quotedAt)return;
    references.push({provider:'tcgdex',source:provider,sourceLabel:provider==='cardmarket'?'Cardmarket via TCGdex':'TCGplayer via TCGdex',market:provider==='cardmarket'?'Europe':'North America',currency:provider==='cardmarket'?'EUR':'USD',valueCents,methodology:field==='marketPrice'?'market_reference':'trend_reference',quotedAt,fetchedAt:fetchedAt||new Date(now).toISOString(),stale:now-Date.parse(quotedAt)>7*DAY,cardId,setId,referenceLanguage:language,marketLanguage:null,condition:null,conditionAdjusted:false,variant,sourceUrl,match:'PARTIAL',brazilian:false,converted:false,usableForBrlValuation:false,providerMappingVerified:false,...extra});
  };
  if(pricing?.cardmarket?.unit==='EUR'){
    const record=pricing.cardmarket;
    // Generic trend is assigned to a finish only when the catalogue has exactly
    // one known finish. Marketplace mapping remains explicitly unverified.
    add('cardmarket',record,'trend',knownFinishes.length===1?knownFinishes[0]:null,{finishBasis:knownFinishes.length===1?'single_catalog_variant':'unspecified'});
    if(raw?.variants?.holo===true&&minorUnits(record['trend-holo'])!==null)add('cardmarket',{...record,trend:record['trend-holo']},'trend','HOLO',{finishBasis:'provider_holo_field'});
  }
  if(pricing?.tcgplayer?.unit==='USD'){
    for(const[key,variant]of Object.entries(FINISHES))if(pricing.tcgplayer[key])add('tcgplayer',{...pricing.tcgplayer[key],updated:pricing.tcgplayer.updated},'marketPrice',variant,{finishBasis:'provider_variant_field'});
  }
  return {provider:'tcgdex',cardId,setId,referenceLanguage:language,references,knownFinishes,lastCheckedAt:fetchedAt||new Date(now).toISOString(),notice:'Referências internacionais em EUR/USD. A fonte não informa conservação nem idioma de mercado; não são preços brasileiros ou avaliações ajustadas à condição. A correspondência do marketplace não é certificada.'};
}
function selectInternationalMarket(data,item={},now=Date.now()){
  const attributes=item.attributes||[],finish=item.variant||'NORMAL';
  const references=(data?.references||[]).map(quote=>({...quote,stale:quote.stale||now-Date.parse(quote.quotedAt)>7*DAY}));
  const supported=!attributes.length&&(!data?.knownFinishes?.length||data.knownFinishes.includes(finish));
  const compatible=references.filter(quote=>supported&&quote.variant===finish).sort((a,b)=>Number(b.finishBasis==='provider_holo_field')-Number(a.finishBasis==='provider_holo_field'));
  const current=compatible.filter(quote=>!quote.stale);
  const selected=current.find(quote=>quote.source==='tcgplayer')||current[0]||null;
  return {references,compatible,current,selected,finishSupported:supported,conditionMatched:false,languageMatched:false,notice:data?.notice||'Sem referência internacional disponível.',unavailableReason:attributes.length?'Atributos especiais sem referência correspondente.':!supported?'Acabamento informado sem referência correspondente.':!selected?'Sem referência internacional atual para este acabamento.':null};
}
function internationalTotals(items){
  const totals=new Map();
  for(const item of items){if(!['IN_COLLECTION','FOR_SALE'].includes(item.status))continue;const seen=new Set();for(const quote of item.internationalMarket?.current||[]){const key=quote.source+'|'+quote.currency;if(seen.has(key))continue;seen.add(key);if(!totals.has(key))totals.set(key,{source:quote.source,sourceLabel:quote.sourceLabel,currency:quote.currency,valueCents:0,quantity:0,conditionMatched:false,languageMatched:false});const total=totals.get(key);total.valueCents+=quote.valueCents*item.quantity;total.quantity+=item.quantity;}}
  return [...totals.values()];
}
module.exports={minorUnits,normalizeTcgdexMarket,selectInternationalMarket,internationalTotals};
