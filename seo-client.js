const ORIGIN='https://lojabkm.com.br';
const PUBLIC=new Set(['/','/index.html','/busca','/cartas','/lacrados','/colecoes','/sobre','/contato','/envio','/trocas','/privacidade','/termos','/perguntas-frequentes']);
export function seoState({url,environment,demo=false,title='BKM TCG',description,contentAvailable=true}={}){
 const current=new URL(url,ORIGIN),pathname=current.pathname.replace(/\/$/,'')||'/',canonical=new URL(pathname==='/index.html'?'/':pathname,ORIGIN),catalog=['/busca','/cartas','/lacrados'].includes(pathname),allowed=new Set(catalog?['page',...(pathname==='/busca'?['set']:[])]:[]);
 let validQuery=true;
 for(const key of current.searchParams.keys())if(!allowed.has(key)&&!/^utm_[a-z_]+$/.test(key)&&!['gclid','fbclid'].includes(key))validQuery=false;
 if(current.searchParams.has('set')){const value=current.searchParams.get('set');if(pathname==='/busca'&&/^[A-Za-z0-9_+.-]{1,100}$/.test(value||'')&&current.searchParams.getAll('set').length===1)canonical.searchParams.set('set',value);else validQuery=false;}
 if(current.searchParams.has('page')){const value=current.searchParams.get('page');if(catalog&&/^[1-9]\d{0,4}$/.test(value||'')&&current.searchParams.getAll('page').length===1){if(Number(value)>1)canonical.searchParams.set('page',value);}else validQuery=false;}
 const publicPath=PUBLIC.has(pathname)||/^\/produto\/[^/]+$/.test(pathname),indexable=environment==='production'&&!demo&&current.origin===ORIGIN&&publicPath&&validQuery&&contentAvailable;
 return{canonical:canonical.href,indexable,robots:indexable?'index, follow, max-image-preview:large':'noindex, nofollow',title:String(title).slice(0,200),...(description?{description:String(description).slice(0,300)}:{})};
}
export function applySeoState({document:doc=globalThis.document,...input}={}){
 const state=seoState(input);if(!doc)return state;
 const meta=(selector,attributes)=>{let node=doc.querySelector(selector);if(!node){node=doc.createElement(selector.startsWith('link')?'link':'meta');doc.head.append(node);}for(const[key,value]of Object.entries(attributes))node.setAttribute(key,value);return node;};
 meta('link[rel="canonical"]',{rel:'canonical',href:state.canonical});meta('meta[name="robots"]',{name:'robots',content:state.robots});meta('meta[property="og:url"]',{property:'og:url',content:state.canonical});meta('meta[property="og:title"]',{property:'og:title',content:state.title});if(state.description){meta('meta[name="description"]',{name:'description',content:state.description});meta('meta[property="og:description"]',{property:'og:description',content:state.description});}
 for(const script of doc.querySelectorAll('script[data-bkm-seo]'))if(script.getAttribute('data-seo-url')!==state.canonical||!state.indexable)script.remove();
 return state;
}
