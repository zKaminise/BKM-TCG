export const DEFAULT_HERO_PACK_IMAGE='/assets/pack-herois-v6.png';

// Store settings can reference a bundled/uploaded image or a public HTTPS asset.
// Reject executable schemes, credentials and backslash/encoded path surprises.
export function normalizeHeroPackImage(value){
  if(typeof value!=='string'||!value.trim())return DEFAULT_HERO_PACK_IMAGE;
  const source=value.trim();
  if(source.length>2048||/[\u0000-\u0020\u007f\\]/.test(source))return DEFAULT_HERO_PACK_IMAGE;
  if(/^\/(?:assets|uploads)\/[A-Za-z0-9_./%-]+(?:\?[^#]*)?$/.test(source)){
    try{const path=decodeURIComponent(source.split('?')[0]);if(path.split('/').some(part=>part==='.'||part==='..')||path.includes('\\')||/[\u0000-\u0020\u007f]/.test(path))return DEFAULT_HERO_PACK_IMAGE;return source;}catch{return DEFAULT_HERO_PACK_IMAGE;}
  }
  try{
    const rawMatch=source.match(/^https:\/\/[^/?#]+([^?#]*)/i);if(!rawMatch)return DEFAULT_HERO_PACK_IMAGE;
    const rawPath=rawMatch[1]||'',path=decodeURIComponent(rawPath);
    if(path.split('/').some(part=>part==='.'||part==='..')||/[\u0000-\u0020\u007f\\]/.test(path))return DEFAULT_HERO_PACK_IMAGE;
    const url=new URL(source);return url.protocol==='https:'&&!url.username&&!url.password&&url.hostname&&!url.hash?url.href:DEFAULT_HERO_PACK_IMAGE;
  }catch{return DEFAULT_HERO_PACK_IMAGE;}
}
export const resolveHeroPackImage=normalizeHeroPackImage;

// The supplied photograph remains untouched. This frame selects only the
// packet when its original image is mapped onto the wrapper's native 3D mesh.
export function heroPackImageFrame(value){
  let pathname;try{pathname=new URL(value,'https://lojabkm.com.br').pathname;}catch{pathname='';}
  return pathname===DEFAULT_HERO_PACK_IMAGE?{left:134/1024,bottom:84/1536,width:758/1024,height:1372/1536,contour:true}:{left:0,bottom:0,width:1,height:1,contour:false};
}

// Loading an older edit must never overwrite the latest store setting. Failed
// image updates preserve the scene that already works and dispose stale textures.
export function createHeroPackImageController({load,apply,onError=()=>{},initialUrl=''}){
  let sequence=0,currentUrl=initialUrl,active=true;
  return {
    async update(value){
      const url=normalizeHeroPackImage(value),version=++sequence;
      if(!active||url===currentUrl)return false;
      let texture;
      try{texture=await load(url);if(!active||version!==sequence){texture?.dispose?.();return false;}await apply(texture,url);currentUrl=url;return true;}
      catch(error){texture?.dispose?.();if(active&&version===sequence)onError(error,url);return false;}
    },
    destroy(){active=false;++sequence;},
    get currentUrl(){return currentUrl;}
  };
}
