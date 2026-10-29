'use strict';
const KINDS=['SINGLE','SEALED','CUSTOM'];
const ITEM_TYPES=['BOOSTER','BLISTER','DECK','ETB','BOX','TIN','ACCESSORY','OTHER_SEALED'];
const PROFILE_FIELDS=['id','name','weightGrams','widthCm','heightCm','lengthCm','maxUnits','basePriceCents','kinds','itemTypes','active'];
function validatePackingProfiles(values,fail){
  if(!Array.isArray(values)||values.length>20)fail('VALIDATION','Cadastre até 20 perfis de embalagem.');
  const seen=new Set();
  return values.map(row=>{
    if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).some(key=>!PROFILE_FIELDS.includes(key)))fail('VALIDATION','Perfil de embalagem inválido.');
    const text=(value,max)=>typeof value==='string'&&value.trim().length<=max&&!/[\u0000-\u001f\u007f]/.test(value)?value.trim():'';
    const id=text(row.id,80),name=text(row.name,100);
    if(!/^[A-Za-z0-9_-]{1,80}$/.test(id)||!name||seen.has(id))fail('VALIDATION','Informe nomes e identificadores únicos para os perfis.');seen.add(id);
    if(typeof row.active!=='boolean'||!Number.isSafeInteger(row.weightGrams)||row.weightGrams<1||row.weightGrams>30000||!Number.isSafeInteger(row.maxUnits)||row.maxUnits<1||row.maxUnits>10000||!Number.isSafeInteger(row.basePriceCents)||row.basePriceCents<0||row.basePriceCents>100000000)fail('VALIDATION','Revise peso, capacidade, acréscimo e ativação dos perfis.');
    const result={id,name,active:row.active,weightGrams:row.weightGrams,maxUnits:row.maxUnits,basePriceCents:row.basePriceCents};
    for(const key of ['widthCm','heightCm','lengthCm']){const value=row[key];if(typeof value!=='number'||!Number.isFinite(value)||value<.1||value>300||Math.abs(value*10-Math.round(value*10))>1e-8)fail('VALIDATION','Medidas dos perfis devem ter de 0,1 a 300 cm, com até uma casa decimal.');result[key]=value;}
    for(const [key,allowed]of[['kinds',KINDS],['itemTypes',ITEM_TYPES]]){if(!Array.isArray(row[key])||row[key].length>allowed.length||row[key].some(value=>!allowed.includes(value)))fail('VALIDATION','Tipos atendidos pelo perfil inválidos.');result[key]=[...new Set(row[key])];}
    if(!result.kinds.length)fail('VALIDATION','Escolha os tipos de produto atendidos pelo perfil.');
    if(result.itemTypes.length&&!result.kinds.includes('SEALED'))fail('VALIDATION','Subtipos de selado exigem que o perfil aceite produtos selados.');
    return result;
  });
}
function packingProfilesReady(settings){
  if(settings.packingProfilesValidated!==true||!/^\d{4}-\d{2}-\d{2}$/.test(settings.packingProfilesValidatedAt||''))return false;
  try{const profiles=validatePackingProfiles(settings.packingProfiles,()=>{throw Error('invalid');});return profiles.some(row=>row.active);}catch{return false;}
}
function productItemType(item){const value=String(item.itemType||item.productAttributes?.itemType||item.productAttributes?.category||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();return ({LATA:'TIN',ACESSORIO:'ACCESSORY','ELITE TRAINER BOX':'ETB'})[value]||value;}
function packingPlan(settings,items,netCents){
  if(!packingProfilesReady(settings))return {available:false,reason:'Confirme os pesos, medidas e capacidades reais dos perfis de embalagem.'};
  if(!Array.isArray(items)||!items.length)return {available:false,reason:'Adicione produtos para calcular o frete.'};
  const groups=new Map(),profiles=settings.packingProfiles.filter(row=>row.active);let gross=0;
  for(const item of items){
    if(!KINDS.includes(item.kind)||!Number.isSafeInteger(item.quantity)||item.quantity<1||!Number.isSafeInteger(item.totalCents)||item.totalCents<0)return {available:false,reason:'Não foi possível determinar a embalagem dos produtos.'};
    const type=productItemType(item),matches=profiles.filter(row=>row.kinds.includes(item.kind)&&(item.kind!=='SEALED'||!row.itemTypes.length||row.itemTypes.includes(type))).sort((a,b)=>Number(b.itemTypes.length>0)-Number(a.itemTypes.length>0));
    const profile=matches[0];if(!profile)return {available:false,reason:'A loja ainda não definiu um perfil de envio para algum item do carrinho.'};
    if(!groups.has(profile.id))groups.set(profile.id,{profile,quantity:0,valueCents:0});const group=groups.get(profile.id);group.quantity+=item.quantity;group.valueCents+=item.totalCents;gross+=item.totalCents;
  }
  const rows=[...groups.values()],count=rows.reduce((n,row)=>n+Math.ceil(row.quantity/row.profile.maxUnits),0);
  if(count>20)return {available:false,reason:'Este carrinho excede os volumes configurados. Consulte a loja para combinar o envio.'};
  let allocated=0;const volumes=[],summary=[];
  rows.forEach((row,index)=>{
    const number=Math.ceil(row.quantity/row.profile.maxUnits),insured=index===rows.length-1?netCents-allocated:gross?Number(BigInt(netCents)*BigInt(row.valueCents)/BigInt(gross)):0;allocated+=insured;
    for(let i=0;i<number;i++)volumes.push({weightGrams:row.profile.weightGrams,widthCm:row.profile.widthCm,heightCm:row.profile.heightCm,lengthCm:row.profile.lengthCm,insuranceValueCents:Math.floor(insured/number)+(i<insured%number?1:0)});
    summary.push({profileId:row.profile.id,name:row.profile.name,quantity:row.quantity,volumes:number,basePriceCents:row.profile.basePriceCents});
  });
  return {available:true,volumes,summary,volumeCount:count};
}
module.exports={validatePackingProfiles,packingProfilesReady,packingPlan,productItemType};
