'use strict';
const CARD_ATTRIBUTES=['PROMO','STAMP','FIRST_EDITION','SPECIAL_EDITION'];
function normalizeVariantAttributes(value){
  if(value===undefined||value===null)return [];
  if(!Array.isArray(value)||value.length>4||value.some(code=>!CARD_ATTRIBUTES.includes(code)))throw new TypeError('Selecione somente atributos de carta válidos.');
  return [...new Set(value)].sort();
}
function attributesFromRow(row){try{return normalizeVariantAttributes(typeof row?.attributes_json==='string'?JSON.parse(row.attributes_json):row?.attributes);}catch{return [];}}
function variantIdentity(value){return [value.language,value.condition,value.finish,JSON.stringify(normalizeVariantAttributes(value.attributes))].join('|');}
module.exports={CARD_ATTRIBUTES,normalizeVariantAttributes,attributesFromRow,variantIdentity};
