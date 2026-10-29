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
