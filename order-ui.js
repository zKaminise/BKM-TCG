const paidStates=new Set(['APPROVED','PAID']);
const array=value=>Array.isArray(value)?value:[];
const deliveryOf=order=>order.deliveryMode||order.shipping?.deliveryMode||order.shipment?.deliveryMode||'delivery';
export function orderProgressState(order={}){
  const payment=order.paymentStatus||order.payment?.status||'PENDING',status=order.status||'PENDING',shipping=order.shippingStatus||order.shipment?.status||'UNFULFILLED',delivery=deliveryOf(order),paid=paidStates.has(payment);
  const paidBefore=paid||['REFUNDED','CHARGEBACK'].includes(payment)||status==='REFUNDED'||array(order.history).some(event=>event.type==='PAYMENT'&&paidStates.has(event.status));
  const achieved=()=>!paidBefore?0:shipping==='DELIVERED'?4:shipping==='SHIPPED'?3:shipping==='READY_TO_SHIP'?delivery==='delivery'?2:3:shipping==='PROCESSING'?2:1;
  let current=0,label='Aguardando pagamento',description='Seu pedido foi registrado. Conclua o pagamento dentro do prazo para continuar.',exception=null;
  if(paid){current=1;label='Pagamento recebido';description='O pagamento foi confirmado. Acompanhe aqui a preparação do seu pedido.';if(['PROCESSING','READY_TO_SHIP','SHIPPED','DELIVERED'].includes(shipping)){current=2;label='Pedido em separação';description='Estamos preparando os itens do seu pedido.';}}
  if(paid&&shipping==='READY_TO_SHIP'){
    if(delivery==='pickup'){current=3;label='Pronto para retirada';description='Seu pedido está separado. Combine a retirada com a BKM pelo WhatsApp.';}
    else if(delivery==='local'){current=3;label='Pronto para entrega local';description='Seu pedido está separado. Combine a entrega em Uberlândia com a BKM pelo WhatsApp.';}
    else{label='Separado para envio';description='Seu pedido está embalado. O próximo passo é a postagem e o registro do rastreio.';}
  }
  if(paid&&shipping==='SHIPPED'){current=3;label=delivery==='pickup'?'Pronto para retirada':delivery==='local'?'Saiu para entrega local':'Pedido enviado';description=delivery==='delivery'?'O pedido foi postado. Consulte o código e o link de rastreamento abaixo.':'Acompanhe a conclusão com a equipe da BKM.';}
  if(paid&&shipping==='DELIVERED'){current=4;label=delivery==='pickup'?'Pedido retirado':'Pedido entregue';description=delivery==='pickup'?'A retirada foi confirmada. Obrigado por comprar com a BKM!':'A entrega foi confirmada. Obrigado por comprar com a BKM!';}
  if(payment==='CHARGEBACK'){exception='review';current=achieved();label='Pagamento contestado';description='O pagamento está em análise. As etapas já registradas continuam visíveis; acompanhe as orientações da BKM neste pedido.';}
  else if(status==='REFUNDED'||payment==='REFUNDED'){exception='closed';current=achieved();label='Pedido reembolsado';description='O reembolso foi registrado. As etapas já realizadas permanecem no histórico. Consulte o prazo de devolução no seu meio de pagamento.';}
  else if(status==='PAYMENT_REVIEW'||payment==='REVIEW'){exception='review';current=paidBefore?achieved():0;label='Pedido em análise';description=paid?'O pagamento foi recebido, mas a equipe precisa conferir o pedido antes de continuar.':'Estamos conferindo o pagamento. Aguarde a atualização deste pedido antes de pagar novamente.';}
  else if(payment==='EXPIRED'||status==='EXPIRED'){exception='closed';current=0;label='Prazo de pagamento encerrado';description='A reserva deste pedido terminou. Confira a disponibilidade para realizar uma nova compra.';}
  else if(payment==='REJECTED'){exception='closed';current=0;label='Pagamento não aprovado';description='Este pagamento não foi aprovado. Confira a disponibilidade dos produtos antes de realizar uma nova compra.';}
  else if(status==='CANCELLED'||payment==='CANCELLED'){exception='closed';current=achieved();label='Pedido cancelado';description='Este pedido foi encerrado. Se houve pagamento, acompanhe a orientação da equipe sobre a devolução.';}
  const steps=[{id:'created',label:'Pedido realizado',icon:'orders'},{id:'paid',label:'Pagamento recebido',icon:'check'},{id:'preparing',label:'Em separação',icon:'bag'},{id:'fulfillment',label:delivery==='pickup'?'Pronto para retirada':delivery==='local'?'Pronto para entrega':'Pedido enviado',icon:delivery==='pickup'?'pin':'bag'},{id:'delivered',label:delivery==='pickup'?'Pedido retirado':'Pedido entregue',icon:'check'}].map((step,index)=>({...step,state:index<current||current===4&&index===4?'complete':index===current&&!exception?'current':index===current&&exception?(index===0||paidBefore?'complete':'future'):'future'}));
  return {payment,status,shipping,delivery,current,label,description,exception,steps,paid};
}
export function createOrderProgress({el,icon},order){
  const model=orderProgressState(order),stateNames={complete:'Concluído',current:'Etapa atual',future:'Próxima etapa'};
  return el('section',{class:'bkm-order-progress'+(model.exception?' is-'+model.exception:''),'aria-label':'Acompanhamento do pedido'},el('div',{class:'bkm-order-progress-heading'},el('p',{class:'shop-kicker'},'ACOMPANHE SEU PEDIDO'),el('h2',{},model.label),el('p',{},model.description)),el('ol',{class:'bkm-order-steps','aria-label':'Etapas do pedido'},model.steps.map((step,index)=>el('li',{class:'bkm-order-step is-'+step.state,...(step.state==='current'?{'aria-current':'step'}:{})},el('span',{class:'bkm-order-step-icon','aria-hidden':'true'},typeof icon==='function'?icon(step.icon):String(index+1)),el('span',{class:'bkm-order-step-text'},el('strong',{},step.label),el('small',{},stateNames[step.state]))))));
}
export function safeOrderTrackingUrl(value){
  if(typeof value!=='string'||!value.trim()||value.length>2000)return null;
  try{const url=new URL(value.trim());return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}
}
const copyUsing=async(ctx,value)=>{if(typeof ctx.copyText==='function')return ctx.copyText(value);if(!globalThis.navigator?.clipboard?.writeText)throw Error('Clipboard unavailable');await globalThis.navigator.clipboard.writeText(value);};
export function createOrderTracking(ctx,order={}){
  const {el,button,toast=()=>{}}=ctx,delivery=deliveryOf(order),status=order.shippingStatus||order.shipment?.status,tracking=order.tracking||{},shipment=order.shipment||{},code=String(order.trackingCode||tracking.code||shipment.trackingCode||'').trim();
  if(delivery!=='delivery'||!['SHIPPED','DELIVERED'].includes(status)||!code)return null;
  const carrier=String(tracking.carrier||shipment.carrier||order.shipping?.carrier||'Transportadora'),url=safeOrderTrackingUrl(order.trackingUrl||tracking.url||shipment.trackingUrl),input=el('input',{class:'bkm-order-tracking-code',type:'text',readonly:true,value:code,'aria-label':'Código de rastreamento'}),copy=button('Copiar código',async()=>{try{await copyUsing(ctx,code);toast('Código de rastreamento copiado.');}catch{input.focus();input.select();toast('Selecione e copie o código de rastreamento.');}},'shop-button secondary');
  return el('section',{class:'bkm-order-tracking','aria-label':'Rastreamento da entrega'},el('p',{class:'shop-kicker'},'RASTREAMENTO'),el('h2',{},'Acompanhe sua entrega'),el('p',{class:'bkm-order-tracking-carrier'},carrier),el('p',{},'Copie o código e consulte o site da transportadora para acompanhar seu pedido.'),el('div',{class:'bkm-order-tracking-copy'},input,copy),url?el('a',{class:'shop-button',href:url,target:'_blank',rel:'noopener noreferrer'},'Rastrear na transportadora ↗'):el('p',{class:'shop-fine'},'O link de consulta será disponibilizado pela BKM.'));
}
export function createPixPayment(ctx,{payment,amountCents,canPay=()=>true,onExpired=()=>{}}={}){
  const {el,button,toast=()=>{},money=value=>(value/100).toFixed(2)}=ctx,pix=payment?.pix||{},copyPaste=typeof pix.copyPaste==='string'?pix.copyPaste:'',base64=typeof pix.qrCodeBase64==='string'?pix.qrCodeBase64:'';
  const code=el('textarea',{class:'shop-pix-code',readonly:true,rows:'4','aria-label':'Código Pix copia e cola',value:copyPaste});
  const qr=base64.length<=262144&&/^[A-Za-z0-9+/]+=*$/.test(base64)?el('figure',{class:'bkm-pix-qr'},el('img',{src:'data:image/png;base64,'+base64,alt:'QR Code Pix deste pedido',width:'320',height:'320'}),el('figcaption',{},'Abra o aplicativo do seu banco e escaneie o QR Code.')):el('p',{class:'shop-fine'},'A imagem do QR Code não está disponível. Você pode pagar com o código Pix copia e cola.');
  const copy=button('Copiar código Pix',async()=>{if(!canPay()){onExpired();return;}try{await copyUsing(ctx,copyPaste);toast('Código Pix copiado.');}catch{code.focus();code.select();toast('Selecione e copie o código Pix acima.');}},'shop-button');
  return el('div',{class:'bkm-pix-payment'},el('div',{class:'bkm-pix-intro'},el('h3',{},'Pague com Pix'),Number.isSafeInteger(amountCents)?el('p',{class:'bkm-pix-amount'},money(amountCents)):null,el('p',{},'Escaneie o QR Code ou copie o código abaixo. As duas opções pagam este mesmo pedido.')),el('div',{class:'bkm-pix-methods'},qr,el('div',{class:'bkm-pix-copy'},el('h4',{},'Pix copia e cola'),code,copy,el('p',{class:'shop-fine'},'Confira o beneficiário e o valor no aplicativo do banco. Após pagar, a confirmação aparece automaticamente neste pedido.'))));
}
