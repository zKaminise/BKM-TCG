const test=require('node:test'),assert=require('node:assert/strict');
class Element{
 constructor(tag,props={},children=[]){this.tag=tag;this.children=[];this.listeners={};Object.assign(this,props);for(const[key,value]of Object.entries(props))if(/^on[A-Z]/.test(key))this.listeners[key.slice(2).toLowerCase()]=value;this.append(...children);}
 append(...children){this.children.push(...children);}get textContent(){return this.children.map(node=>node instanceof Element?node.textContent:String(node)).join(' ');}all(){return this.children.flatMap(child=>child instanceof Element?[child,...child.all()]:[]);}async click(){return this.listeners.click?.({currentTarget:this,preventDefault(){}});}focus(){this.focused=true;}select(){this.selected=true;}
}
const el=(tag,props={},...children)=>new Element(tag,props,children.flat(Infinity).filter(value=>value!==null&&value!==undefined&&value!==false));
const button=(text,onClick,cls)=>el('button',{onClick,class:cls},text),ctx={el,button,icon:name=>el('svg',{'data-icon':name}),money:value=>'R$ '+(value/100).toFixed(2)},ui=import('../order-ui.js');
test('progress names all five stages and colors only stages actually reached',async()=>{
 const {orderProgressState,createOrderProgress}=await ui,pending=orderProgressState({status:'PENDING',paymentStatus:'PENDING'});assert.equal(pending.current,0);assert.deepEqual(pending.steps.map(row=>row.state),['current','future','future','future','future']);
 const paid=orderProgressState({status:'CONFIRMED',paymentStatus:'APPROVED',shippingStatus:'UNFULFILLED'});assert.equal(paid.current,1);assert.equal(paid.label,'Pagamento recebido');
 const preparing={status:'CONFIRMED',paymentStatus:'APPROVED',shippingStatus:'PROCESSING'},model=orderProgressState(preparing);assert.deepEqual(model.steps.map(row=>row.state),['complete','complete','current','future','future']);const screen=createOrderProgress(ctx,preparing);assert.match(screen.textContent,/Pedido em separação/);assert.equal(screen.all().filter(node=>node['aria-current']==='step').length,1);assert.equal(screen.all().filter(node=>node.tag==='li').length,5);assert.doesNotMatch(screen.textContent,/null|undefined/);
});
test('pickup, local delivery and postal shipping expose their actual next step',async()=>{
 const {orderProgressState}=await ui,base={status:'CONFIRMED',paymentStatus:'APPROVED',shippingStatus:'READY_TO_SHIP'};
 const pickup=orderProgressState({...base,deliveryMode:'pickup'});assert.equal(pickup.current,3);assert.equal(pickup.steps[3].label,'Pronto para retirada');assert.equal(pickup.steps[4].label,'Pedido retirado');
 const local=orderProgressState({...base,deliveryMode:'local'});assert.equal(local.current,3);assert.equal(local.label,'Pronto para entrega local');
 const postal=orderProgressState({...base,deliveryMode:'delivery'});assert.equal(postal.current,2);assert.equal(postal.label,'Separado para envio');assert.equal(postal.steps[3].state,'future');
 const shipped=orderProgressState({...base,shippingStatus:'SHIPPED'});assert.equal(shipped.current,3);assert.equal(shipped.label,'Pedido enviado');
 for(const deliveryMode of['delivery','local','pickup']){const delivered=orderProgressState({...base,deliveryMode,shippingStatus:'DELIVERED'});assert.equal(delivered.current,4);assert.ok(delivered.steps.every(step=>step.state==='complete'));}
});
test('cancelled, expired, rejected and review do not imply payment or fulfillment success',async()=>{
 const {orderProgressState}=await ui;
 for(const paymentStatus of['CANCELLED','EXPIRED','REJECTED','REVIEW']){const model=orderProgressState({status:paymentStatus==='REVIEW'?'PAYMENT_REVIEW':'CANCELLED',paymentStatus,shippingStatus:'UNFULFILLED'});assert.ok(model.exception);assert.equal(model.steps[0].state,'complete');assert.ok(model.steps.slice(1).every(row=>row.state==='future'));assert.doesNotMatch(model.label,/Pedido entregue|Pagamento recebido/);}
 const late=orderProgressState({status:'PAYMENT_REVIEW',paymentStatus:'APPROVED',shippingStatus:'UNFULFILLED'});assert.equal(late.current,1);assert.equal(late.exception,'review');assert.equal(late.steps[2].state,'future');
});
test('refund, chargeback and a financial review preserve recorded physical delivery history',async()=>{
 const {orderProgressState}=await ui;
 for(const paymentStatus of['REFUNDED','CHARGEBACK']){const model=orderProgressState({status:paymentStatus==='REFUNDED'?'REFUNDED':'PAYMENT_REVIEW',paymentStatus,shippingStatus:'DELIVERED'});assert.ok(model.exception);assert.equal(model.current,4);assert.ok(model.steps.every(step=>step.state==='complete'));assert.match(model.description,/etapas/i);}
 const review=orderProgressState({status:'PAYMENT_REVIEW',paymentStatus:'REVIEW',shippingStatus:'SHIPPED',history:[{type:'PAYMENT',status:'APPROVED'}]});assert.equal(review.current,3);assert.equal(review.steps[3].state,'complete');assert.equal(review.steps[4].state,'future');
});
test('tracking shows the saved per-order carrier/link, supports copying and refuses unsafe URLs',async()=>{
 const {createOrderTracking,safeOrderTrackingUrl}=await ui,copied=[],notices=[],order={deliveryMode:'delivery',shippingStatus:'SHIPPED',tracking:{carrier:'Jadlog',code:'QA123456789BR',url:'https://www.jadlog.com.br/siteInstitucional/tracking.jad'}};
 const screen=createOrderTracking({...ctx,copyText:async value=>copied.push(value),toast:value=>notices.push(value)},order);assert.match(screen.textContent,/Jadlog/);const input=screen.all().find(row=>row.tag==='input');assert.equal(input.value,'QA123456789BR');const anchor=screen.all().find(row=>row.tag==='a');assert.equal(anchor.href,order.tracking.url);assert.equal(anchor.target,'_blank');assert.equal(anchor.rel,'noopener noreferrer');await screen.all().find(row=>row.tag==='button').click();assert.deepEqual(copied,['QA123456789BR']);assert.equal(notices.length,1);
 for(const value of['javascript:alert(1)','http://example.test/','data:text/html,test','https://a:b@example.test/','//example.test','not a URL'])assert.equal(safeOrderTrackingUrl(value),null);
 assert.equal(createOrderTracking(ctx,{...order,deliveryMode:'pickup'}),null);assert.equal(createOrderTracking(ctx,{...order,deliveryMode:'local'}),null);assert.equal(createOrderTracking(ctx,{...order,shippingStatus:'READY_TO_SHIP'}),null);
 const unsafe=createOrderTracking(ctx,{...order,tracking:{...order.tracking,url:'javascript:alert(1)'}});assert.equal(unsafe.all().some(row=>row.tag==='a'),false);
});
test('Pix presents QR and exact copy/paste alternatives for the same payment and prevents copying after expiry',async()=>{
 const {createPixPayment}=await ui,copied=[],notices=[];let allowed=true,expired=0;const pix={copyPaste:'000201-PAYLOAD-SINTETICO-EXATO',qrCodeBase64:'iVBORw0KGgo='};
 const screen=createPixPayment({...ctx,copyText:async value=>copied.push(value),toast:value=>notices.push(value)},{payment:{pix},amountCents:1000,canPay:()=>allowed,onExpired:()=>expired++});const image=screen.all().find(row=>row.tag==='img');assert.equal(image.src,'data:image/png;base64,'+pix.qrCodeBase64);assert.equal(image.alt,'QR Code Pix deste pedido');assert.equal(screen.all().find(row=>row.tag==='textarea').value,pix.copyPaste);assert.match(screen.textContent,/mesmo pedido/);assert.match(screen.textContent,/R\$ 10.00/);assert.doesNotMatch(screen.textContent,/null|undefined/);
 const copy=screen.all().find(row=>row.tag==='button');await copy.click();assert.deepEqual(copied,[pix.copyPaste]);allowed=false;await copy.click();assert.equal(copied.length,1);assert.equal(expired,1);assert.equal(notices.length,1);
});
test('missing QR preserves copy/paste and clipboard failure selects the code without sending it elsewhere',async()=>{
 const {createPixPayment}=await ui,screen=createPixPayment({...ctx,copyText:async()=>{throw Error('clipboard unavailable');}},{payment:{pix:{copyPaste:'SYNTHETIC-PIX'}}});assert.equal(screen.all().some(row=>row.tag==='img'),false);assert.match(screen.textContent,/imagem do QR Code não está disponível/);await screen.all().find(row=>row.tag==='button').click();const code=screen.all().find(row=>row.tag==='textarea');assert.equal(code.selected,true);assert.equal(code.focused,true);
});
