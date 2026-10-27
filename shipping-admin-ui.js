const REGIONS=[['N','Norte'],['NE','Nordeste'],['CO','Centro-Oeste'],['SE','Sudeste'],['S','Sul']];
const STATES='AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');

export function parseShippingCepRanges(value){
  const values=String(value||'').split(/[\n,]/).map(row=>row.trim()).filter(Boolean);
  if(values.length>100)throw new Error('Informe até 100 faixas de CEP.');
  const ranges=values.map(row=>{
    const parts=row.split(':').map(part=>part.trim());
    if(parts.length!==2||parts.some(part=>!/^\d{5}-?\d{3}$/.test(part)||part.replace('-','')==='00000000'))throw new Error('Informe faixas como 01000000:09999999, uma por linha.');
    const [start,end]=parts.map(part=>part.replace('-',''));
    if(start>end)throw new Error('O início de cada faixa de CEP deve vir antes do fim.');
    return {start,end};
  }).sort((a,b)=>a.start.localeCompare(b.start));
  for(let i=1;i<ranges.length;i++)if(ranges[i].start<=ranges[i-1].end)throw new Error('Há faixas de CEP sobrepostas. Os limites são inclusivos.');
  return ranges;
}
export function parseShippingMoney(value,label,{nullable=false,minimum=0}={}){
  const text=String(value??'').trim();
  if(!text&&nullable)return null;
  if(!/^\d+(?:[.,]\d{1,2})?$/.test(text))throw new Error(`Informe ${label} com até duas casas decimais.`);
  const [whole,fraction='']=text.replace(',','.').split('.'),cents=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  if(!Number.isSafeInteger(cents)||cents<minimum||cents>100000000)throw new Error(`Revise ${label}.`);
  return cents;
}
const rangesText=values=>(Array.isArray(values)?values:[]).map(row=>`${row.start}:${row.end}`).join('\n');

// Credentials are deliberately absent. This editor configures the store's
// operational manual table; a sandbox quote is not a production shipping rate.
export function createShippingAdminEditor({ctx,shipping={},production=false}){
  const {el,field,selectField,checkbox,button,message}=ctx;
  const element=el('section',{class:'shop-admin-section bkm-shipping-admin'}),status=el('div',{class:'bkm-shipping-readiness','aria-live':'polite','aria-atomic':'true'});
  const get=name=>element.querySelector(`[name="${name}"]`);
  const value=name=>get(name)?.value.trim()||'';
  const checked=name=>get(name)?.checked===true;
  const number=(name,label,{nullable=false,min=0,max=365}={})=>{
    const raw=value(name);if(!raw&&nullable)return null;
    const num=Number(raw);if(!raw||!/^\d+$/.test(raw)||!Number.isSafeInteger(num)||num<min||num>max)throw new Error(`Informe ${label} entre ${min} e ${max}.`);return num;
  };
  const packagesList=el('div',{class:'bkm-shipping-packages'}),defaultField=selectField('Embalagem padrão','shippingDefaultPackage',[['','Selecione uma embalagem ativa']],shipping.defaultPackageId||'');
  let serial=0;
  const packageRows=[];
  const regionRows=new Map();
  function clearValidation(){for(const row of regionRows.values()){row.querySelector('[data-shipping-validation]').checked=false;}refresh();}
  function refreshDefaults(){
    const select=defaultField.querySelector('select'),previous=select.value||shipping.defaultPackageId||'';
    select.replaceChildren(el('option',{value:''},'Selecione uma embalagem ativa'));
    for(const row of packageRows)if(row.querySelector('[name$="Active"]').checked)select.append(el('option',{value:row.dataset.packageId},row.querySelector('[name$="Name"]').value.trim()||'Embalagem sem nome'));
    select.value=previous;
    if(select.value!==previous)select.value='';
  }
  function addPackage(pack={}){
    const index=++serial,prefix=`shippingPackage${index}`,id=pack.id||`pack-${Date.now()}-${index}`;
    const row=el('fieldset',{class:'bkm-shipping-package','data-package-id':id},el('legend',{},'Embalagem'),
      field('Nome da embalagem',`${prefix}Name`,'text',pack.name||'',{maxlength:'100',required:true,placeholder:'Nome do pacote que você realmente utiliza'}),
      el('div',{class:'shop-form-grid'},field('Peso total embalado (g)',`${prefix}Weight`,'number',pack.weightGrams??'',{min:'1',max:'30000',step:'1',required:true}),
        ...[['Width','Largura',pack.widthCm],['Height','Altura',pack.heightCm],['Length','Comprimento',pack.lengthCm]].map(([key,label,initial])=>field(`${label} externa (cm)`,`${prefix}${key}`,'number',initial??'',{min:'.1',max:'300',step:'.1',required:true}))),
      checkbox('Embalagem ativa',`${prefix}Active`,pack.active!==false),
      button('Remover embalagem',()=>{const index=packageRows.indexOf(row);packageRows.splice(index,1);row.remove();refreshDefaults();clearValidation();},'shop-text-link'));
    row.dataset.packagePrefix=prefix;packageRows.push(row);packagesList.append(row);
    row.addEventListener('input',()=>{refreshDefaults();clearValidation();});
    row.addEventListener('change',()=>{refreshDefaults();clearValidation();});
    refreshDefaults();refresh();
  }
  function read(){
    const origin=Object.fromEntries(['zip','street','number','complement','district','city','state'].map(key=>[key,value(`shippingOrigin${key}`)]));
    if(origin.zip){if(!/^\d{5}-?\d{3}$/.test(origin.zip)||origin.zip.replace('-','')==='00000000')throw new Error('Informe um CEP de origem válido.');origin.zip=origin.zip.replace('-','');}
    const packages=packageRows.map(row=>{
      const p=row.dataset.packagePrefix,name=value(`${p}Name`);
      if(!name)throw new Error('Dê um nome a cada embalagem ou remova as embalagens incompletas.');
      const dimensions=Object.fromEntries([['widthCm','Width'],['heightCm','Height'],['lengthCm','Length']].map(([key,suffix])=>{
        const raw=value(`${p}${suffix}`),num=Number(raw);
        if(!/^(?:\d+(?:\.\d)?|\.\d)$/.test(raw)||!Number.isFinite(num)||num<.1||num>300)throw new Error('As medidas reais da embalagem devem estar entre 0,1 e 300 cm, com até uma casa decimal.');
        return [key,num];
      }));
      return {id:row.dataset.packageId,name,active:checked(`${p}Active`),weightGrams:number(`${p}Weight`,'o peso embalado em gramas',{min:1,max:30000}),...dimensions};
    });
    const regionRates=Object.fromEntries(REGIONS.map(([id,label])=>{
      const prefix=`shippingRegion${id}`,enabled=checked(`${prefix}Enabled`),carrier=value(`${prefix}Carrier`),serviceName=value(`${prefix}Service`),validated=checked(`${prefix}Validated`),validatedAt=value(`${prefix}Date`)||null;
      const rate={enabled,carrier,serviceName,validated,validatedAt,priceCents:parseShippingMoney(value(`${prefix}Price`),`o frete de ${label}`,{nullable:!enabled}),estimatedDays:number(`${prefix}Days`,`o prazo de ${label}`,{nullable:!enabled,min:enabled?1:0}),cepRanges:parseShippingCepRanges(value(`${prefix}Ranges`))};
      if(enabled&&(!carrier||!serviceName||!validated||!validatedAt))throw new Error(`Em ${label}, informe transportadora, serviço, data e confirme que o preço e o prazo foram validados na operação.`);
      return [id,rate];
    }));
    const result={enabled:checked('shippingEnabled'),rateMode:value('rateMode')||'regional',origin,packages,defaultPackageId:value('shippingDefaultPackage'),regionRates,
      regions:parseShippingCepRanges(value('shippingCoverageRanges')),pickup:{enabled:checked('pickupEnabled')},localDelivery:{enabled:checked('localDeliveryEnabled'),estimatedDays:number('localDeliveryDays','o prazo local',{nullable:true,min:0})},
      freeShippingEnabled:checked('freeShippingEnabled'),freeShippingThresholdCents:parseShippingMoney(value('freeShippingThreshold'),'o mínimo do frete grátis',{nullable:!checked('freeShippingEnabled'),minimum:1}),
      flatRateCents:production?(shipping.flatRateCents??0):parseShippingMoney(value('shippingFlatRate'),'a taxa de demonstração'),estimatedDays:production?(shipping.estimatedDays??0):number('shippingFlatDays','o prazo de demonstração',{min:0})};
    if(result.enabled&&result.rateMode==='regional'){
      const missing=['zip','street','number','district','city','state'].filter(key=>!origin[key]);
      if(missing.length)throw new Error('Complete o endereço privado de origem antes de ativar o envio nacional.');
      if(!packages.some(pack=>pack.active&&pack.id===result.defaultPackageId))throw new Error('Escolha uma embalagem padrão ativa com peso e medidas reais.');
      if(!Object.values(regionRates).some(rate=>rate.enabled))throw new Error('Ative pelo menos uma região com preço e prazo operacionais validados.');
    }
    return result;
  }
  function refresh(){
    // This visible checklist deliberately works while incomplete draft fields
    // cannot yet be submitted. The server always performs the final validation.
    const missing=[];
    if(['zip','street','number','district','city','state'].some(key=>!value(`shippingOrigin${key}`)))missing.push('endereço de origem completo');
    if(!value('shippingDefaultPackage'))missing.push('embalagem padrão ativa, pesada e medida');
    const enabled=REGIONS.filter(([id])=>checked(`shippingRegion${id}Enabled`));
    if(!enabled.length)missing.push('região atendida com tarifa validada');
    for(const[id,label]of enabled){const p=`shippingRegion${id}`;if(!value(`${p}Carrier`)||!value(`${p}Service`)||!value(`${p}Price`)||!value(`${p}Days`)||!value(`${p}Date`)||!checked(`${p}Validated`))missing.push(`validação de ${label}`);}
    const national=checked('shippingEnabled');
    status.replaceChildren(message(missing.length?`${national?'Envio nacional incompleto':'Envio nacional desativado ou em preparação'}. Falta: ${missing.join('; ')}. Retirada e entrega local têm configuração independente.`:`${national?'Envio nacional ativado':'Configuração preenchida, envio nacional desligado'}. A loja utiliza uma tabela manual validada; cotações e etiquetas automáticas não estão ativadas.`,missing.length&&national?'error':'info'));
    const minimum=get('freeShippingThreshold');if(minimum)minimum.required=checked('freeShippingEnabled');
    for(const[id]of REGIONS){const p=`shippingRegion${id}`,active=checked(`${p}Enabled`);for(const suffix of['Carrier','Service','Price','Days','Date']){const input=get(p+suffix);if(input)input.required=active;}const days=get(p+'Days');if(days)days.min=active?'1':'0';}
  }
  const origin=shipping.origin||{};
  element.append(el('h3',{},'Entrega, origem e frete grátis'),el('p',{class:'shop-fine'},'Ative somente os destinos cujos preços e prazos você conferiu com a transportadora. Nenhuma tarifa é preenchida automaticamente ou estimada por região.'),status,
    checkbox('Ativar envio nacional para regiões validadas','shippingEnabled',shipping.enabled===true),
    selectField('Tabela utilizada no checkout','rateMode',production?[['regional','Tarifas operacionais por região']]:[['regional','Tarifas operacionais por região'],['flat','Taxa única de demonstração / legado']],production?'regional':shipping.rateMode||'regional'),
    el('fieldset',{class:'bkm-shipping-origin'},el('legend',{},'Origem da postagem — dados privados da administração'),el('p',{class:'shop-fine'},'Este endereço serve à logística e não é publicado como ponto de retirada. Preencha os dados reais antes de oferecer envio nacional.'),
      el('div',{class:'shop-form-grid'},field('CEP de origem','shippingOriginzip','text',origin.zip||'',{inputmode:'numeric',maxlength:'9',placeholder:'00000-000'}),field('Rua / avenida','shippingOriginstreet','text',origin.street||'',{maxlength:'200'}),field('Número','shippingOriginnumber','text',origin.number||'',{maxlength:'200'}),field('Complemento — opcional','shippingOrigincomplement','text',origin.complement||'',{maxlength:'100'}),field('Bairro','shippingOrigindistrict','text',origin.district||'',{maxlength:'200'}),field('Cidade','shippingOrigincity','text',origin.city||'',{maxlength:'200'}),selectField('UF','shippingOriginstate',[['','Selecione'],...STATES.map(uf=>[uf,uf])],origin.state||''))),
    el('fieldset',{},el('legend',{},'Embalagens utilizadas na postagem'),el('p',{class:'shop-fine'},'Cadastre o peso total do volume pronto para postagem, incluindo cartas, proteção e embalagem. As medidas externas são em centímetros. Pedidos que exigem outra embalagem precisam de tarifa e limite operacional compatíveis.'),packagesList,button('Adicionar embalagem +',()=>{if(packageRows.length>=20)return;addPackage();clearValidation();},'shop-button secondary'),defaultField),
    el('div',{class:'bkm-shipping-regions'},REGIONS.map(([id,label])=>{
      const p=`shippingRegion${id}`,rate=shipping.regionRates?.[id]||{},confirmation=checkbox('Conferi preço, prazo e atendimento deste serviço para os CEPs configurados',`${p}Validated`,rate.validated===true);
      confirmation.querySelector('input').dataset.shippingValidation='true';
      const row=el('fieldset',{class:'bkm-shipping-region'},el('legend',{},label),checkbox('Atender esta região',`${p}Enabled`,rate.enabled===true),el('div',{class:'shop-form-grid'},field('Transportadora',`${p}Carrier`,'text',rate.carrier||'',{maxlength:'100',placeholder:'Prestador contratado / utilizado'}),field('Modalidade / serviço',`${p}Service`,'text',rate.serviceName||'',{maxlength:'100'}),field('Frete cobrado (R$)',`${p}Price`,'number',Number.isSafeInteger(rate.priceCents)?(rate.priceCents/100).toFixed(2):'',{min:'0',max:'1000000',step:'.01'}),field('Prazo estimado (dias úteis)',`${p}Days`,'number',rate.estimatedDays??'',{min:'1',max:'365',step:'1'}),field('Data da conferência operacional',`${p}Date`,'date',rate.validatedAt||'',{max:new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'})})),field('Faixas de CEP nesta região — opcional',`${p}Ranges`,'textarea',rangesText(rate.cepRanges),{rows:'2',placeholder:'01000000:09999999'}),el('p',{class:'shop-fine'},'Uma faixa por linha. Sem faixas, a tarifa atende toda esta região; só confirme se o serviço cobrir todos os destinos. Os limites de cada faixa são inclusivos.'),confirmation);
      regionRows.set(id,row);
      row.addEventListener('input',event=>{if(['Carrier','Service','Price','Days','Ranges'].some(suffix=>event.target.name===p+suffix))confirmation.querySelector('input').checked=false;});
      return row;
    })),
    field('Restrição geral de CEPs — opcional','shippingCoverageRanges','textarea',rangesText(shipping.regions),{rows:'2',placeholder:'01000000:09999999'}),
    el('p',{class:'shop-fine'},'As faixas gerais e as faixas da região são aplicadas juntas. Um CEP fora da cobertura não recebe cotação, mesmo acima do mínimo de frete grátis.'),
    el('div',{class:'shop-shipping-promotion'},checkbox('Oferecer frete grátis a partir de um valor','freeShippingEnabled',shipping.freeShippingEnabled===true),field('Compra mínima para frete grátis (R$)','freeShippingThreshold','number',Number.isSafeInteger(shipping.freeShippingThresholdCents)?(shipping.freeShippingThresholdCents/100).toFixed(2):'150.00',{min:'.01',max:'1000000',step:'.01'}),el('p',{class:'shop-fine'},'A barra do carrinho usa o total dos produtos depois dos descontos. A promoção mantém os limites de cobertura e a disponibilidade do serviço.')),
    el('h3',{},'Retirada e entrega local'),checkbox('Permitir retirada gratuita combinada após pagamento','pickupEnabled',shipping.pickup?.enabled===true),checkbox('Permitir entrega gratuita em Uberlândia/MG','localDeliveryEnabled',shipping.localDelivery?.enabled===true),field('Prazo local (dias úteis) — opcional','localDeliveryDays','number',shipping.localDelivery?.estimatedDays??'',{min:'0',max:'365',step:'1',placeholder:'A combinar pelo WhatsApp'}),el('p',{class:'shop-fine'},'Cadastre cidade/UF e WhatsApp da loja na seção de contato. A retirada dispensa CEP. A entrega local exige CEP de Uberlândia/MG confirmado pelo serviço de endereços. Em branco, o prazo é combinado pelo WhatsApp após pagamento.'),
    el('details',{class:'bkm-shipping-provider-note'},el('summary',{},'Integração automática com transportadora'),el('p',{class:'shop-fine'},'O adaptador Melhor Envio disponível consulta somente sandbox com credencial autorizada. Ele não compra etiquetas, não cota em produção e não fornece tarifas ao checkout. Para integrar produção, configure a conta real, serviços, agência de postagem, credenciais e embalagens; depois valide cotação e rastreio antes de habilitar. Não digite tokens nesta página.')));
  if(!production)element.append(el('details',{},el('summary',{},'Demonstração / legado'),el('div',{class:'shop-form-grid'},field('Taxa única de demonstração (R$)','shippingFlatRate','number',((shipping.flatRateCents||0)/100).toFixed(2),{min:'0',step:'.01'}),field('Prazo da demonstração (dias úteis)','shippingFlatDays','number',shipping.estimatedDays??0,{min:'0',max:'365',step:'1'}))));
  for(const pack of Array.isArray(shipping.packages)?shipping.packages:[])addPackage(pack);
  refreshDefaults();
  element.querySelector('.bkm-shipping-origin').addEventListener('input',clearValidation);
  get('shippingCoverageRanges').addEventListener('input',clearValidation);
  defaultField.addEventListener('change',clearValidation);
  element.addEventListener('input',refresh);element.addEventListener('change',refresh);refresh();
  return {element,read};
}
