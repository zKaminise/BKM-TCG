import {DEFAULT_HERO_PACK_IMAGE,normalizeHeroPackImage} from './hero-media.js';
export function validateHeroPackImageUrl(value){
  if(typeof value!=='string'||value.length>2000)throw new Error('Informe o endereço de uma imagem com até 2.000 caracteres.');
  const text=value.trim();if(!text)return '';
  const normalized=normalizeHeroPackImage(text);
  if(normalized!==DEFAULT_HERO_PACK_IMAGE||text===DEFAULT_HERO_PACK_IMAGE)return normalized;
  throw new Error('Use uma imagem enviada à loja ou um link HTTPS.');
}
export function createHeroMediaEditor(ctx,{imageUrl=''}={}){
  const {el,field,button,image,api,prepareImageUpload,message}=ctx;let busy=false,disposed=false,controller=null;
  const status=el('div',{'aria-live':'polite'}),inputField=field('Imagem do pacote — link HTTPS ou imagem enviada','heroPackImageUrl','text',imageUrl,{maxlength:'2000',placeholder:'Padrão da BKM ou https://…',inputmode:'url'}),input=inputField.querySelector('input');
  const preview=el('div',{class:'shop-hero-media-preview'},image(imageUrl||DEFAULT_HERO_PACK_IMAGE,'Prévia da imagem do pacote da home'));
  function showPreview(){try{const url=validateHeroPackImageUrl(input.value);preview.replaceChildren(image(url||DEFAULT_HERO_PACK_IMAGE,'Prévia da imagem do pacote da home'));status.replaceChildren();}catch(error){status.replaceChildren(message(error.message,'error'));}}
  input.addEventListener('change',showPreview);
  const restoreDefault=button('Usar a imagem padrão da BKM',()=>{input.value=DEFAULT_HERO_PACK_IMAGE;showPreview();status.replaceChildren(message('Prévia da imagem padrão. Salve as configurações para aplicar.'));},'shop-button secondary');
  const upload=el('input',{type:'file',accept:'image/png,image/jpeg,image/webp','aria-label':'Enviar imagem do pacote da animação',onChange:async event=>{const file=event.currentTarget.files?.[0];if(!file||disposed||busy)return;if(!['image/png','image/jpeg','image/webp'].includes(file.type)){status.replaceChildren(message('Escolha uma imagem PNG, JPEG ou WebP.','error'));return;}if(file.size>8*1024*1024){status.replaceChildren(message('Escolha uma imagem com até 8 MB.','error'));return;}busy=true;upload.disabled=true;input.disabled=true;restoreDefault.disabled=true;controller=new AbortController();status.replaceChildren(message('Enviando a imagem do pacote…'));try{const payload=await prepareImageUpload(file);if(disposed)return;const saved=await api('/admin/uploads',{method:'POST',body:payload,signal:controller.signal});if(disposed)return;input.value=validateHeroPackImageUrl(saved.url);showPreview();status.replaceChildren(message('Imagem enviada. Salve as configurações para aplicar na home.','success'));}catch(error){if(!disposed&&error.name!=='AbortError')status.replaceChildren(message(error.message||'Não foi possível enviar a imagem.','error'));}finally{busy=false;if(!disposed){upload.disabled=false;input.disabled=false;restoreDefault.disabled=false;upload.value='';}}}});
  const element=el('section',{class:'shop-admin-section shop-hero-media-editor'},el('h3',{},'Pacote da animação da home'),el('p',{class:'shop-fine'},'Troque a imagem sem alterar a abertura do pacote e a revelação da carta. Prefira a frente do pacote, reta, com fundo transparente e sem margens grandes. PNG, JPEG ou WebP, até 8 MB.'),el('div',{class:'shop-hero-media-grid'},preview,el('div',{},inputField,el('label',{class:'shop-field'},el('span',{},'Enviar imagem do computador'),upload),restoreDefault,el('p',{class:'shop-fine'},'A prévia mostra a imagem selecionada. A mudança só aparece na loja depois de salvar as configurações.'))),status);
  return {element,read(){if(busy)throw new Error('Aguarde o envio da imagem antes de salvar.');return validateHeroPackImageUrl(input.value);},destroy(){disposed=true;controller?.abort();}};
}
