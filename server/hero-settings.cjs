'use strict';
function heroPackSetting(value){
 const invalid=()=>{throw Error('Use uma imagem enviada à loja ou um link HTTPS válido para o pacote.');};
 if(typeof value!=='string'||value.length>2000)invalid();const text=value.trim();if(!text)return '';
 if(/[\u0000-\u0020\u007f\\]/.test(text))invalid();
 if(/^\/(?:assets|uploads)\/[A-Za-z0-9_./%-]+(?:\?[^#]*)?$/.test(text)){let decoded;try{decoded=decodeURIComponent(text.split('?')[0]);}catch{invalid();}if(decoded.split('/').some(part=>part==='.'||part==='..')||/[\u0000-\u0020\u007f\\]/.test(decoded))invalid();return text;}
 try{const match=text.match(/^https:\/\/[^/?#]+([^?#]*)/i);if(!match)invalid();const decoded=decodeURIComponent(match[1]||'');if(decoded.split('/').some(part=>part==='.'||part==='..')||/[\u0000-\u0020\u007f\\]/.test(decoded))invalid();const url=new URL(text);if(url.protocol==='https:'&&!url.username&&!url.password&&!url.hash&&url.hostname)return url.href;}catch{}
 invalid();
}
module.exports={heroPackSetting};
