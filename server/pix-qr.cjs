'use strict';
// Presentation only: the payload is the Mercado Pago copy/paste code already
// reconciled by our payment adapter. No payment or external QR API is called.
const QRCode=require('qrcode'),crypto=require('node:crypto');
const cache=new Map(),inFlight=new Map(),MAX_ENTRIES=80,TTL_MS=120000;
async function createPixPresentation(copyPaste){
  if(typeof copyPaste!=='string'||!copyPaste||copyPaste.length>10000)return null;
  const result={copyPaste};
  // QR capacity is finite. Preserve the authoritative code unchanged even if a
  // malformed/oversized provider value cannot be represented as an image.
  if(Buffer.byteLength(copyPaste,'utf8')>2300)return result;
  const key=crypto.createHash('sha256').update(copyPaste).digest('hex'),cached=cache.get(key);
  if(cached&&cached.expiresAt>Date.now())return {...result,qrCodeBase64:cached.base64};
  if(!inFlight.has(key)){
    if(inFlight.size>=MAX_ENTRIES)return result;
    const operation=QRCode.toDataURL(copyPaste,{type:'image/png',width:320,margin:4,errorCorrectionLevel:'M',color:{dark:'#000000ff',light:'#ffffffff'}}).then(value=>{
      if(!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(value)||value.length>262144)throw Error('Invalid local QR output');
      const base64=value.slice('data:image/png;base64,'.length);
      if(cache.size>=MAX_ENTRIES)cache.delete(cache.keys().next().value);
      cache.set(key,{base64,expiresAt:Date.now()+TTL_MS});return base64;
    }).finally(()=>inFlight.delete(key));inFlight.set(key,operation);
  }
  try{return {...result,qrCodeBase64:await inFlight.get(key)};}catch{return result;}
}
module.exports={createPixPresentation};
