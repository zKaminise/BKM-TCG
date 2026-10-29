// Shared buyer-facing labels. Preserve legacy codes while the editor uses the
// same physical-card terminology as Minha Coleção.
export const productLanguages={pt:'Português (Brasil)',en:'Inglês',ja:'Japonês','zh-tw':'Chinês tradicional','zh-cn':'Chinês simplificado',ko:'Coreano',es:'Espanhol',fr:'Francês',de:'Alemão',it:'Italiano',th:'Tailandês',id:'Indonésio',zh:'Chinês'};
export const productConditions={M:'Mint',NM:'Near Mint',SP:'Slightly Played',MP:'Moderately Played',HP:'Heavily Played',D:'Danificada',LP:'Levemente jogada (LP)',DMG:'Danificada (DMG)',SEALED:'Lacrado',OPENED:'Aberto',CUSTOM:'Não se aplica'};
export const productFinishes={NORMAL:'Normal',HOLO:'Holo',REVERSE:'Reverse holo',POKE_BALL:'Poké Ball',MASTER_BALL:'Master Ball',OTHER:'Outro',FOIL:'Foil',PROMO:'Promocional',FIRST_EDITION:'1ª edição'};
export const productAttributeLabels={PROMO:'Promocional',STAMP:'Carimbo',FIRST_EDITION:'1ª edição',SPECIAL_EDITION:'Edição especial'};
export function productKindLabel(kind,{plural=false}={}){return ({SINGLE:plural?'Cartas avulsas':'Carta avulsa',SEALED:plural?'Lacrados':'Lacrado',CUSTOM:plural?'Personalizados':'Personalizado'})[kind]||'Produto';}
export function productKindPath(kind){return kind==='SINGLE'?'/cartas':kind==='SEALED'?'/lacrados':'/busca?kind=CUSTOM';}
export function variantAttributeText(variant={}){return [...new Set(Array.isArray(variant.attributes)?variant.attributes:[])].map(value=>productAttributeLabels[value]||String(value)).join(' · ');}
export function productVariantText(variant={}, {includeLanguage=true}={}){
  return [includeLanguage&&variant.language?(productLanguages[variant.language]||variant.language):null,variant.condition?(productConditions[variant.condition]||variant.condition):null,variant.finish?(productFinishes[variant.finish]||variant.finish):null,variantAttributeText(variant)].filter(Boolean).join(' · ');
}

export function catalogCardConditions(product={}){
 if(product.kind!=='SINGLE')return [];
 const groups=new Map(),rank=['M','NM','SP','LP','MP','HP','D','DMG'];
 for(const variant of Array.isArray(product.variants)?product.variants:[]){const code=typeof variant.condition==='string'?variant.condition.trim():'';if(!code)continue;const prior=groups.get(code);groups.set(code,{code,label:productConditions[code]||code,available:!!prior?.available||variant.stock>0});}
 return [...groups.values()].sort((a,b)=>(rank.includes(a.code)?rank.indexOf(a.code):99)-(rank.includes(b.code)?rank.indexOf(b.code):99));
}

// These flags identify the printing language, not the country of manufacture.
// Inline static SVGs render consistently on Windows and require no third party.
const flagShapes={
 pt:'<path fill="#009739" d="M0 0h30v20H0z"/><path fill="#ffdf00" d="m15 2 12 8-12 8L3 10z"/><circle cx="15" cy="10" r="5" fill="#002776"/><path d="M10.4 8.4q5-1 9.4 3" fill="none" stroke="white" stroke-width=".8"/>',
 en:'<path fill="#fff" d="M0 0h30v20H0z"/><path stroke="#b22234" stroke-width="1.54" d="M0 .77h30M0 3.85h30M0 6.92h30M0 10h30M0 13.08h30M0 16.15h30M0 19.23h30"/><path fill="#3c3b6e" d="M0 0h13v10.77H0z"/><path fill="white" d="M2 2h1v1H2zm4 0h1v1H6zm4 0h1v1h-1zM4 4h1v1H4zm4 0h1v1H8zM2 6h1v1H2zm4 0h1v1H6zm4 0h1v1h-1zM4 8h1v1H4zm4 0h1v1H8z"/>',
 ja:'<path fill="#fff" d="M0 0h30v20H0z"/><circle cx="15" cy="10" r="6" fill="#bc002d"/>',
 'zh-cn':'<path fill="#de2910" d="M0 0h30v20H0z"/><path fill="#ffde00" d="m6 3 1.1 3.3h3.5L7.8 8.4l1.1 3.3L6 9.6l-2.9 2.1 1.1-3.3L1.4 6.3h3.5z"/><g fill="#ffde00"><circle cx="12" cy="3" r=".8"/><circle cx="14" cy="6" r=".8"/><circle cx="14" cy="10" r=".8"/><circle cx="12" cy="13" r=".8"/></g>',
 'zh-tw':'<path fill="#fe0000" d="M0 0h30v20H0z"/><path fill="#000095" d="M0 0h15v10H0z"/><g fill="white"><path d="m7.5 1 .7 2 1.7-1.2-.4 2.1 2.1.2L10 5.5l1.6 1.4-2.1.2.4 2.1-1.7-1.1-.7 2-.7-2-1.7 1.1.4-2.1-2.1-.2L5 5.5 3.4 4.1l2.1-.2-.4-2.1 1.7 1.2z"/><circle cx="7.5" cy="5.5" r="2.3"/></g>',
 ko:'<path fill="white" d="M0 0h30v20H0z"/><circle fill="#cd2e3a" cx="15" cy="10" r="5"/><path fill="#0047a0" d="M10 10a5 5 0 0 0 10 0q-2.5 4-5 0t-5 0"/><path stroke="#111" d="m4 4 3 3m-4-2 3 3m17-4-3 3m4-2-3 3M4 16l3-3m-4 2 3-3m17 4-3-3m4 2-3-3"/>',
 es:'<path fill="#aa151b" d="M0 0h30v20H0z"/><path fill="#f1bf00" d="M0 5h30v10H0z"/><path fill="#aa151b" d="M7 8h3v5H7z"/>',
 fr:'<path fill="#ed2939" d="M0 0h30v20H0z"/><path fill="white" d="M0 0h20v20H0z"/><path fill="#002395" d="M0 0h10v20H0z"/>',
 de:'<path fill="#ffce00" d="M0 0h30v20H0z"/><path fill="#d00" d="M0 0h30v13.33H0z"/><path fill="#000" d="M0 0h30v6.67H0z"/>',
 it:'<path fill="#ce2b37" d="M0 0h30v20H0z"/><path fill="white" d="M0 0h20v20H0z"/><path fill="#009246" d="M0 0h10v20H0z"/>',
 th:'<path fill="#a51931" d="M0 0h30v20H0z"/><path fill="#f4f5f8" d="M0 3.33h30v13.34H0z"/><path fill="#2d2a4a" d="M0 6.67h30v6.66H0z"/>',
 id:'<path fill="white" d="M0 0h30v20H0z"/><path fill="#ce1126" d="M0 0h30v10H0z"/>'
};
const flagCountries={pt:'Brasil',en:'Estados Unidos',ja:'Japão','zh-cn':'China','zh-tw':'Taiwan',ko:'Coreia do Sul',es:'Espanha',fr:'França',de:'Alemanha',it:'Itália',th:'Tailândia',id:'Indonésia'};
export function productLanguagePresentation(language){
 const code=String(language||''),flagCode=code==='zh'?'zh-cn':code,shape=flagShapes[flagCode];
 return {code,label:productLanguages[code]||code||'Não informado',country:flagCountries[flagCode]||'',flagUrl:shape?`data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20">${shape}</svg>`)}`:''};
}
const conditionDetails={
 M:['Mint','Estado impecável'],NM:['Near Mint','Sinais mínimos de manuseio'],SP:['Levemente jogada','Leve desgaste'],MP:['Moderadamente jogada','Desgaste moderado'],HP:['Muito jogada','Desgaste acentuado'],D:['Danificada','Danos visíveis'],LP:['Levemente jogada','Leve desgaste'],DMG:['Danificada','Danos visíveis'],SEALED:['Lacrado','Embalagem lacrada'],OPENED:['Aberto','Embalagem aberta'],CUSTOM:['Não se aplica','Item personalizado']
};
export function productConditionPresentation(condition){
 const code=String(condition||''),details=conditionDetails[code];
 return {code:code||'—',label:details?.[0]||code||'Não informada',description:details?.[1]||'Confira a descrição e as fotos do anúncio',isCard:!['SEALED','OPENED','CUSTOM'].includes(code)};
}
export function setProductVariantChoiceSelected(node,selected){node.classList.toggle('selected',!!selected);node.setAttribute('aria-pressed',String(!!selected));}
export function createProductVariantChoice({el,button,money},variant,{selected=false,onSelect=()=>{}}={}){
 const language=productLanguagePresentation(variant.language),condition=productConditionPresentation(variant.condition),extra=[variant.finish?productFinishes[variant.finish]||variant.finish:'',variantAttributeText(variant)].filter(Boolean).join(' · ');
 const languageRow=el('span',{class:'shop-variant-language'},language.flagUrl?el('img',{src:language.flagUrl,alt:'','aria-hidden':'true',class:'shop-language-flag',width:'30',height:'20'}):null,el('span',{},el('small',{},'Idioma'),el('strong',{},language.label)));
 const conditionRow=el('span',{class:'shop-variant-condition'},condition.isCard?el('strong',{class:'shop-condition-code'},condition.code):null,el('span',{},el('small',{},condition.isCard?'Conservação':'Estado do produto'),el('strong',{},condition.label),el('span',{class:'shop-condition-description'},condition.description)));
 const node=button([languageRow,conditionRow,extra?el('span',{class:'shop-variant-finish'},extra):null,el('span',{class:'shop-variant-chosen','aria-hidden':'true'},'✓ Selecionada')],event=>onSelect(variant,event),`shop-variant shop-variant-option${selected?' selected':''}`,{'aria-label':`${language.label}, ${condition.isCard?condition.code+' — ':''}${condition.label}, ${condition.description}${extra?', '+extra:''}, ${money(variant.priceCents)}${variant.stock<=0?', indisponível':''}`,'aria-pressed':String(selected),disabled:variant.stock<=0});
 return node;
}
