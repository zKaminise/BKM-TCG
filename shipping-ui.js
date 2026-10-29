const optionsOf=shipping=>(Array.isArray(shipping?.options)?shipping.options:[]).filter(option=>typeof option?.id==='string'&&Number.isSafeInteger(option.priceCents)&&option.priceCents>=0);
export function shippingServiceLabel(option={}){return [option.carrier,option.serviceName].filter(Boolean).filter((value,index,values)=>values.indexOf(value)===index).join(' · ')||'Entrega padrão';}
export function createShippingOptionList({el,money,shipping,selectedId,onSelect,name='shippingService',disabled=false}){
  const options=optionsOf(shipping);if(!options.length)return null;
  const selected=selectedId||shipping.selectedOptionId||options[0].id;
  return el('fieldset',{class:'bkm-shipping-options'},el('legend',{},'Opções de entrega'),options.map(option=>el('label',{class:'bkm-shipping-option'+(option.id===selected?' is-selected':'')},el('input',{type:'radio',name,value:option.id,checked:option.id===selected,disabled,onChange:event=>{if(event.currentTarget.checked)onSelect?.(option.id);}}),el('span',{class:'bkm-shipping-option-description'},el('strong',{},shippingServiceLabel(option)),el('small',{},Number.isSafeInteger(option.estimatedDays)?`Estimativa: ${option.estimatedDays} ${option.estimatedDays===1?'dia útil':'dias úteis'} após a postagem.`:'Prazo de entrega indisponível.'),option.originalPriceCents>option.priceCents?el('small',{class:'bkm-shipping-benefit'},`Benefício no frete: ${money(option.originalPriceCents-option.priceCents)}`):null),el('strong',{class:'bkm-shipping-option-price'},option.priceCents===0?'Grátis':money(option.priceCents)))),options.some(option=>option.originalPriceCents>option.priceCents)?el('p',{class:'shop-fine'},'A opção mais econômica fica grátis; nas demais, você paga somente a diferença já exibida.'):null);
}
export function createShippingPreview(ctx,{getItems,product=false,initialCep='',saveCep=()=>{}}={}){
  const {el,button,api,message,money}=ctx;
  let active=true,sequence=0,controller=null,selectedId='',hasQuote=false;
  const result=el('div',{class:'bkm-shipping-preview-result','aria-live':'polite','aria-atomic':'true'}),input=el('input',{name:'cep',type:'text',placeholder:'00000-000','aria-label':'CEP de entrega',inputmode:'numeric',maxlength:'9',value:initialCep,required:true,pattern:'[0-9]{5}-?[0-9]{3}'});
  const replace=(...nodes)=>result.replaceChildren(...nodes.flat(Infinity).filter(node=>node!==null&&node!==undefined&&node!==false));
  const calculate=button('Calcular frete',()=>form.requestSubmit(),'shop-button secondary');
  const form=el('form',{class:'shop-shipping bkm-shipping-preview',onSubmit:event=>{event.preventDefault();selectedId='';run();}},el('label',{class:'shop-label'},product?'Calcule o frete deste produto':'Calcule o frete do pedido'),el('div',{class:'shop-inline-form'},input,calculate),product?el('p',{class:'shop-fine'},'Usa a versão e a quantidade escolhidas. No carrinho, calculamos todos os itens juntos.'):null,result);
  function invalidate(){++sequence;controller?.abort();controller=null;selectedId='';calculate.disabled=false;calculate.textContent='Calcular frete';if(hasQuote)replace(message('A seleção mudou. Calcule o frete novamente.'));hasQuote=false;}
  input.addEventListener('input',invalidate);
  async function run(){
    const cep=input.value.replace(/\D/g,''),items=getItems?.()||[];
    if(!/^\d{8}$/.test(cep)||cep==='00000000'){replace(message('Informe um CEP válido com oito números.','error'));return;}
    if(!items.length){replace(message(product?'Escolha uma versão disponível e a quantidade para calcular.':'Adicione um produto ao carrinho para calcular o frete.'));return;}
    const version=++sequence;controller?.abort();controller=new AbortController();const request=controller;calculate.disabled=true;calculate.textContent='Calculando…';replace(message('Consultando as opções para o seu CEP…'));
    try{
      const quote=await api('/checkout/quote',{method:'POST',body:{items,cep,...(selectedId?{shippingOptionId:selectedId}:{})},signal:request.signal});
      if(!active||version!==sequence||request.signal.aborted)return;
      hasQuote=true;saveCep(cep);const shipping=quote.shipping||{};selectedId=shipping.selectedOptionId||selectedId;
      if(!shipping.available){replace(message(shipping.reason||'Não há entrega disponível para esse CEP.'));return;}
      const options=createShippingOptionList({el,money,shipping,selectedId,name:'previewShippingService',onSelect:id=>{selectedId=id;run();}}),mode=shipping.deliveryMode;
      replace(mode==='pickup'?message('Retirada gratuita na loja.'):mode==='local'?message('Entrega gratuita em Uberlândia/MG. Prazo a combinar após o pagamento.'):options||message(`Frete: ${money(quote.shippingCents)}`),shipping.destination?el('p',{class:'shop-fine'},`${shipping.destination.city} / ${shipping.destination.state}`):null,mode==='delivery'?el('p',{class:'shop-fine'},shipping.provider==='melhorenvio'?'Cotação das transportadoras. Serviço e valor serão conferidos novamente ao finalizar.':'Calculado pela tabela da BKM para os itens informados. Valor conferido novamente ao finalizar.'):null);
    }catch(error){if(active&&version===sequence&&error.name!=='AbortError')replace(message(error.message||'Não foi possível consultar o frete. Tente novamente.','error'));}
    finally{if(active&&version===sequence){calculate.disabled=false;calculate.textContent='Calcular frete';}}
  }
  form.invalidate=invalidate;
  form.destroy=()=>{active=false;++sequence;controller?.abort();};
  return form;
}
