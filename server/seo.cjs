'use strict';
const fs=require('node:fs'),path=require('node:path');
const OFFICIAL_ORIGIN='https://lojabkm.com.br';
const INDEX_RULE='index, follow, max-image-preview:large';
const NOINDEX_RULE='noindex, nofollow';
const INFO={
 '/sobre':['Sobre a BKM TCG','Cartas Pokémon TCG e colecionáveis na BKM TCG, em Uberlândia/MG. Conheça a loja e encontre sua próxima descoberta.'],
 '/contato':['Atendimento BKM TCG','Fale com a BKM TCG sobre cartas Pokémon, pedidos, retirada e entrega em Uberlândia/MG.'],
 '/envio':['Envio, entrega e retirada','Consulte as modalidades disponíveis para seu CEP no checkout da BKM TCG. Retirada e entrega local são combinadas após a confirmação do pagamento.'],
 '/trocas':['Trocas e devoluções','Conheça as orientações da BKM TCG para trocas e devoluções e fale com o atendimento sobre seu pedido.'],
 '/privacidade':['Privacidade','Consulte as informações de privacidade e uso de dados da sua conta BKM TCG.'],
 '/termos':['Termos da loja','Consulte as condições de uso e compra da BKM TCG.'],
 '/perguntas-frequentes':['Perguntas frequentes','Saiba como comprar cartas Pokémon TCG na BKM, conferir idioma e condição, pagar e acompanhar seu pedido.']
};
const escape=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch]);
const json=value=>JSON.stringify(value).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
const parse=value=>{try{return JSON.parse(value);}catch{return null;}};
function publicMode(env={},host=''){
 return env.BKM_ENVIRONMENT==='production'&&env.HOSTING_DEMO_ONLY==='false'&&env.BKM_PUBLIC_URL===OFFICIAL_ORIGIN&&(!env.VERCEL_ENV||env.VERCEL_ENV==='production')&&String(host).toLowerCase().split(':')[0]==='lojabkm.com.br';
}
function safeImage(value){if(typeof value!=='string'||!value.trim())return null;try{const url=new URL(value,OFFICIAL_ORIGIN);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}}
function canonicalUrl(url){
 const result=new URL(url.pathname==='/index.html'?'/':url.pathname.replace(/\/$/,'')||'/',OFFICIAL_ORIGIN);
 if(['/busca','/cartas','/lacrados'].includes(result.pathname)){
  const set=url.searchParams.get('set');if(result.pathname==='/busca'&&/^[A-Za-z0-9_+.-]{1,100}$/.test(set||''))result.searchParams.set('set',set);
  const page=url.searchParams.get('page');if(/^[1-9]\d{0,4}$/.test(page||'')&&Number(page)>1)result.searchParams.set('page',page);
 }
 return result.href;
}
function cleanQuery(url){
 const allowed=new Set(['/busca','/cartas','/lacrados'].includes(url.pathname)?['page',...(url.pathname==='/busca'?['set']:[])]:[]);
 for(const key of url.searchParams.keys())if(!allowed.has(key)&&!/^utm_[a-z_]+$/.test(key)&&!['gclid','fbclid'].includes(key))return false;
 if(url.searchParams.has('set')&&(!allowed.has('set')||!/^[A-Za-z0-9_+.-]{1,100}$/.test(url.searchParams.get('set')||'')))return false;
 if(url.searchParams.has('page')&&!/^[1-9]\d{0,4}$/.test(url.searchParams.get('page')||''))return false;
 return [...allowed].every(key=>url.searchParams.getAll(key).length<=1);
}
function privateRoute(pathname){return /^\/(?:admin|conta|checkout|carrinho|favoritos|entrar|cadastro|recuperar-senha)(?:\/|$)/.test(pathname);}
const productPath=slug=>'/produto/'+encodeURIComponent(slug);
function productSchema(product){
 const images=product.images.map(image=>safeImage(typeof image==='string'?image:image?.url)).filter(Boolean);
 const url=OFFICIAL_ORIGIN+productPath(product.slug);
 return {'@type':'Product','@id':url+'#product',name:product.name,description:product.description||`${product.name}${product.setName?' — '+product.setName:''}. Confira idioma, conservação, acabamento e disponibilidade na BKM TCG.`,...(images.length?{image:images}:{}),sku:product.sku,url,offers:product.variants.map(variant=>({'@type':'Offer',url,sku:product.sku+'-'+variant.id,priceCurrency:'BRL',price:(variant.priceCents/100).toFixed(2),availability:'https://schema.org/'+(variant.stock>0?'InStock':'OutOfStock'),itemCondition:'https://schema.org/'+(['SEALED','M'].includes(variant.condition)?'NewCondition':'UsedCondition'),seller:{'@type':'Organization',name:'BKM TCG',url:OFFICIAL_ORIGIN}}))};
}
function productSummary(product){
 const image=product.images.map(image=>safeImage(typeof image==='string'?image:image?.url)).find(Boolean),url=productPath(product.slug);
 const variants=product.variants.map(v=>`<li>${escape([v.language,v.condition,v.finish].filter(Boolean).join(' · '))} — ${(v.priceCents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})} — ${v.stock>0?'Disponível':'Indisponível'}</li>`).join('');
 return `<article><a href="${escape(url)}">${image?`<img src="${escape(image)}" alt="${escape(product.name)}" width="175" height="245" style="object-fit:contain">`:''}<h2>${escape(product.name)}</h2></a>${product.setName?`<p>${escape(product.setName)}</p>`:''}<p>${escape(product.description)}</p><ul>${variants}</ul></article>`;
}
function hydrateShell(template,{title,description,canonical,robots,body='',schema=[],verification=''}){
 let html=template.replace(/<title>[\s\S]*?<\/title>/i,`<title>${escape(title)}</title>`)
  .replace(/<meta\b[^>]*name=["'](?:description|robots)["'][^>]*>\s*/gi,'')
  .replace(/<link\b[^>]*rel=["']canonical["'][^>]*>\s*/gi,'')
  .replace(/<meta\b[^>]*property=["']og:(?:title|description|url|type|image)["'][^>]*>\s*/gi,'');
 const head=`<meta name="description" content="${escape(description)}"><meta name="robots" content="${escape(robots)}"><link rel="canonical" href="${escape(canonical)}" data-commerce><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}"><meta property="og:url" content="${escape(canonical)}"><meta property="og:type" content="${schema.some(x=>x['@type']==='Product')?'product':'website'}"><meta property="og:image" content="${escape(schema.find(x=>x['@type']==='Product')?.image?.[0]||OFFICIAL_ORIGIN+'/assets/bkm-logo-original.png')}"><meta name="twitter:card" content="summary_large_image">${schema.length?`<script type="application/ld+json" data-bkm-seo data-seo-url="${escape(canonical)}">${json({'@context':'https://schema.org','@graph':schema})}</script>`:''}`;
 html=html.replace('</head>',head+(/^[A-Za-z0-9_-]{16,256}$/.test(verification)?`<meta name="google-site-verification" content="${escape(verification)}">`:'')+'\n</head>');
 if(body)html=html.replace(/(<section\b[^>]*id=["']storefront["'][^>]*>)[\s\S]*?(<\/section>)/i,(_all,open,close)=>open+`<div class="shop-shell bkm-seo-content">${body}</div>`+close);
 return html;
}
function createSeoHandler({db,env={},root=path.resolve(__dirname,'..'),templatePath}={}){
 const readTemplate=()=>fs.readFileSync(templatePath||path.join(root,'index.html'),'utf8');
 async function products({slug,kind,set,offset=0,limit=12}={}){
  let sql='SELECT p.id,p.slug,p.kind,p.name,p.description,p.sku,p.set_id,p.set_name,p.images_json,p.updated_at FROM products p WHERE p.published=1 AND p.archived=0 AND EXISTS(SELECT 1 FROM variants v WHERE v.product_id=p.id AND v.active=1)',args=[];
  if(slug!==undefined){sql+=' AND p.slug=?';args.push(slug);}if(kind){sql+=' AND p.kind=?';args.push(kind);}if(set){sql+=' AND p.set_id=?';args.push(set);}sql+=' ORDER BY p.created_at DESC,p.id LIMIT ? OFFSET ?';args.push(limit,offset);
  const rows=await db.prepare(sql).all(...args),result=[];
  for(const p of rows){const variants=await db.prepare("SELECT v.id,v.language,v.condition,v.finish,v.price_cents,v.stock,(SELECT COALESCE(SUM(r.quantity),0) FROM inventory_reservations r WHERE r.variant_id=v.id AND r.status='ACTIVE' AND r.expires_at>?) reserved FROM variants v WHERE v.product_id=? AND v.active=1 ORDER BY v.price_cents,v.id").all(Date.now(),p.id);result.push({id:p.id,slug:p.slug,kind:p.kind,name:p.name,description:p.description,sku:p.sku,setId:p.set_id,setName:p.set_name,images:Array.isArray(parse(p.images_json))?parse(p.images_json):[],updatedAt:p.updated_at,variants:variants.map(v=>({id:v.id,language:v.language,condition:v.condition,finish:v.finish,priceCents:v.price_cents,stock:Math.max(0,v.stock-v.reserved)}))});}
  return result;
 }
 async function sitemap(){
  const rows=await db.prepare('SELECT p.slug,p.kind,p.set_id,p.updated_at FROM products p WHERE p.published=1 AND p.archived=0 AND EXISTS(SELECT 1 FROM variants v WHERE v.product_id=p.id AND v.active=1) ORDER BY p.slug LIMIT 49901').all();
  if(rows.length>49900)throw Error('Sitemap requires partitioning');
  const paths=new Map([['/',null],['/busca',null],...Object.keys(INFO).map(p=>[p,null])]);
  if(rows.some(p=>p.kind==='SINGLE'))paths.set('/cartas',null);if(rows.some(p=>p.kind==='SEALED'))paths.set('/lacrados',null);
  const sets=new Set(rows.map(p=>p.set_id).filter(Boolean));if(sets.size)paths.set('/colecoes',null);
  for(const set of sets)if(/^[A-Za-z0-9_+.-]{1,100}$/.test(set))paths.set('/busca?'+new URLSearchParams({set}),null);
  for(const row of rows)paths.set(productPath(row.slug),Number.isFinite(Date.parse(row.updated_at))?new Date(row.updated_at).toISOString():null);
  if(paths.size>50000)throw Error('Sitemap requires partitioning');
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[...paths].map(([p,date])=>`<url><loc>${escape(OFFICIAL_ORIGIN+p)}</loc>${date?`<lastmod>${date}</lastmod>`:''}</url>`).join('')}</urlset>`;
 }
 async function handle(req,res,pathname){
  if(pathname.startsWith('/api/')||pathname==='/api'||!['/robots.txt','/sitemap.xml','/index.html'].includes(pathname)&&path.extname(pathname))return false;
  if(!['GET','HEAD'].includes(req.method))return false;
  const host=String(req.headers.host||'').toLowerCase().split(':')[0],isPublic=publicMode(env,host),url=new URL(req.url,OFFICIAL_ORIGIN);url.pathname=pathname;
  const send=(status,body,type='text/html; charset=utf-8',robots=NOINDEX_RULE)=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Robots-Tag':robots});res.end(req.method==='HEAD'?'':body);return true;};
  if(env.BKM_ENVIRONMENT==='production'&&env.BKM_PUBLIC_URL===OFFICIAL_ORIGIN&&['www.lojabkm.com.br','bkm-tcg-demo.vercel.app'].includes(host)){
   res.writeHead(308,{Location:OFFICIAL_ORIGIN+url.pathname+url.search,'Cache-Control':'public, max-age=300'});res.end();return true;
  }
  if(pathname==='/robots.txt')return send(200,isPublic?'User-agent: *\nAllow: /\nDisallow: /api/\nAllow: /api/config\nAllow: /api/session\nAllow: /api/products\nAllow: /api/collections\nDisallow: /admin\nDisallow: /conta\nDisallow: /checkout\nDisallow: /carrinho\nDisallow: /entrar\nDisallow: /cadastro\nDisallow: /recuperar-senha\nDisallow: /favoritos\nSitemap: '+OFFICIAL_ORIGIN+'/sitemap.xml\n':'User-agent: *\nDisallow: /\n','text/plain; charset=utf-8');
  if(pathname==='/sitemap.xml'){
   if(!isPublic)return send(200,'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>','application/xml; charset=utf-8');
   try{return send(200,await db.exclusive(sitemap),'application/xml; charset=utf-8');}catch{return send(503,'<?xml version="1.0" encoding="UTF-8"?><error>Temporariamente indisponível</error>','application/xml; charset=utf-8');}
  }
  let title='BKM TCG — Cartas Pokémon TCG e colecionáveis',description='Encontre cartas Pokémon TCG, boosters e selados por coleção, idioma e conservação. BKM TCG em Uberlândia/MG.',canonical=canonicalUrl(url),status=200,indexable=false,body='',schema=[];
  const route=pathname.replace(/\/$/,'')||'/';
  try{
   if(privateRoute(route))title='Sua conta e pedidos · BKM TCG';
   else if(route==='/'||route==='/index.html'){
    indexable=true;const list=await db.exclusive(()=>products({limit:12}));body=`<h1>Cartas Pokémon TCG e colecionáveis na BKM TCG</h1><p>${escape(description)}</p><nav aria-label="Categorias"><a href="/cartas">Cartas avulsas Pokémon</a> · <a href="/lacrados">Boosters e produtos selados</a> · <a href="/colecoes">Coleções Pokémon</a> · <a href="/busca">Ver todos os produtos</a></nav><div class="shop-product-grid">${list.map(productSummary).join('')}</div>`;schema=[{'@type':'Organization','@id':OFFICIAL_ORIGIN+'/#organization',name:'BKM TCG',url:OFFICIAL_ORIGIN,logo:OFFICIAL_ORIGIN+'/assets/bkm-logo-original.png'},{'@type':'WebSite','@id':OFFICIAL_ORIGIN+'/#website',name:'BKM TCG',url:OFFICIAL_ORIGIN,inLanguage:'pt-BR'}];
   }else if(['/busca','/cartas','/lacrados'].includes(route)){
    const page=/^[1-9]\d{0,4}$/.test(url.searchParams.get('page')||'')?Number(url.searchParams.get('page')):1,set=route==='/busca'?url.searchParams.get('set'):null,list=await db.exclusive(()=>products({kind:route==='/cartas'?'SINGLE':route==='/lacrados'?'SEALED':null,set,offset:(page-1)*12,limit:12}));
    const name=set&&list.length?list[0].setName:route==='/cartas'?'Cartas avulsas Pokémon TCG':route==='/lacrados'?'Boosters e selados Pokémon TCG':'Catálogo Pokémon TCG';title=name+' · BKM TCG';description=`${name}: confira cartas e produtos disponíveis, idiomas, conservação e preços na BKM TCG.`;indexable=list.length>0;
    body=`<h1>${escape(name)}</h1><p>${escape(description)}</p><div class="shop-product-grid">${list.map(productSummary).join('')}</div>${page>1?`<a href="${escape(canonical.replace(/([?&])page=\d+/,(_m,prefix)=>page===2?'':prefix+'page='+(page-1)).replace(/[?&]$/,''))}">Página anterior</a>`:''}${list.length===12?`<a href="${escape((()=>{const next=new URL(canonical);next.searchParams.set('page',String(page+1));return next.pathname+next.search;})())}">Próxima página</a>`:''}`;
   }else if(route.startsWith('/produto/')){
    let slug;try{slug=decodeURIComponent(route.slice(9));}catch{slug='';}const product=slug&&!slug.includes('/')?(await db.exclusive(()=>products({slug,limit:1})))[0]:null;
    if(!product){status=404;title='Produto não encontrado · BKM TCG';body='<h1>Produto não encontrado</h1><a href="/busca">Explorar o catálogo</a>';}
    else{indexable=true;title=product.name+(product.setName?' — '+product.setName:'')+' · BKM TCG';description=(product.description||`${product.name}${product.setName?' da coleção '+product.setName:''}. Confira idioma, conservação, acabamento e disponibilidade na BKM TCG.`).slice(0,250);body=`<h1>${escape(product.name)}</h1>${productSummary(product)}<p>Confira a versão e a quantidade desejadas antes de adicionar ao carrinho.</p>`;schema=[productSchema(product)];}
   }else if(route==='/colecoes'){
    const sets=await db.exclusive(()=>db.prepare("SELECT DISTINCT set_id,set_name FROM products WHERE published=1 AND archived=0 AND set_id<>'' ORDER BY set_name").all());indexable=sets.length>0;title='Coleções de Pokémon TCG · BKM TCG';body='<h1>Coleções de Pokémon TCG</h1><ul>'+sets.map(s=>`<li><a href="/busca?${escape(new URLSearchParams({set:s.set_id}))}">${escape(s.set_name)}</a></li>`).join('')+'</ul>';
   }else if(INFO[route]){[title,description]=INFO[route];title+=' · BKM TCG';indexable=true;body=`<h1>${escape(INFO[route][0])}</h1><p>${escape(description)}</p><a href="/busca">Explorar produtos</a> · <a href="/contato">Falar com o atendimento</a>`;}
   else{status=404;title='Página não encontrada · BKM TCG';body='<h1>Página não encontrada</h1><a href="/busca">Explorar o catálogo</a>';}
  }catch{status=503;indexable=false;schema=[];body='<h1>A loja está temporariamente indisponível</h1><p>Tente novamente em alguns instantes.</p>';}
  const robots=isPublic&&indexable&&cleanQuery(url)&&status===200?INDEX_RULE:NOINDEX_RULE;
  try{return send(status,hydrateShell(readTemplate(),{title,description,canonical,robots,body,schema,verification:isPublic?env.GOOGLE_SITE_VERIFICATION||'':''}),'text/html; charset=utf-8',robots);}catch{return send(503,'A loja está temporariamente indisponível.');}
 }
 return {handle,sitemap,products};
}
module.exports={OFFICIAL_ORIGIN,publicMode,canonicalUrl,cleanQuery,privateRoute,productSchema,hydrateShell,createSeoHandler};
