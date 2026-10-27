'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {openStore}=require('../server/store.cjs');
const {createCollectionCatalog,parseSearch,asset}=require('../server/collection-catalog.cjs');
class ApiError extends Error {constructor(status,code,message){super(message);Object.assign(this,{status,code});}}

async function fixture(t,engine='sqlite') {
  const pg=engine==='postgres'?new PGlite():null;
  const pgClient=pg?{query:async(sql,args)=>args?.length?pg.query(sql,args):(await pg.exec(sql)).at(-1),end:()=>pg.close()}:undefined;
  const db=openStore({dbPath:':memory:',pgClient,env:{}});await db.ready;t.after(()=>db.close());
  let clock=Date.parse('2026-10-27T12:00:00Z'),online=true;
  const calls=[];
  const sets=[
    {id:'spring1',name:'Jardim das Sombras 151',cardCount:{official:165,total:180},serie:{id:'spring',name:'Primavera'},abbreviation:{official:'SPR'}},
    {id:'night2',name:'Noite Iluminada',cardCount:{official:165,total:190},serie:{id:'night',name:'Noite'},abbreviation:{official:'NGT'}},
    {id:'rock3',name:'Montanhas',cardCount:{official:181,total:190},serie:{id:'rock',name:'Rochas'}},
    {id:'A1',name:'Digital Pocket',cardCount:{official:165,total:200},serie:{id:'tcgp',name:'Pocket'}}
  ];
  const cards=[
    {id:'spring1-166',localId:'166',name:'Fleur',rarity:'Ilustração Rara',illustrator:'Artist A',dexId:[12],variants:{holo:true,normal:false,reverse:false},image:'https://assets.tcgdex.net/pt/spring/spring1/166',set:sets[0]},
    {id:'spring1-170',localId:'170',name:'Nageur',rarity:'Ilustração Rara',dexId:[25],image:'https://assets.tcgdex.net/pt/spring/spring1/170',set:sets[0]},
    {id:'night2-166',localId:'166',name:'Lune',rarity:'Rara',illustrator:'Artist B',dexId:[10],image:'https://assets.tcgdex.net/pt/night/night2/166',set:sets[1]},
    {id:'rock3-033',localId:'033',name:'Rochér',rarity:'Comum',image:'https://assets.tcgdex.net/pt/rock/rock3/033',set:sets[2]},
    {id:'A1-166',localId:'166',name:'Digital Fleur',rarity:'Rara',image:'https://assets.tcgdex.net/en/tcgp/A1/166',set:sets[3]}
  ];
  const fetchImpl=async input=>{
    const url=new URL(input);assert.equal(url.origin,'https://api.tcgdex.net');calls.push(url.href);
    if(!online)throw new Error('Offline');
    const [lang,type,id]=url.pathname.split('/').slice(2);
    let result=null;
    if(type==='series')result=id==='tcgp'?{id,sets:[sets[3]]}:[{id:'spring',name:'Primavera'},{id:'night',name:'Noite'},{id:'rock',name:'Rochas'},{id:'tcgp',name:'Pocket'}];
    if(type==='sets'&&!id){result=sets.map(set=>({...set,name:lang==='en'?({spring1:'Shadow Garden',night2:'Moon Light',rock3:'Mountains',A1:'Digital Pocket'})[set.id]:set.name}));const abbreviation=url.searchParams.get('abbreviation.official');if(abbreviation)result=result.filter(row=>row.abbreviation?.official===abbreviation);}
    if(type==='sets'&&id){const set=sets.find(set=>set.id===id);if(set)result={...set,cards:cards.filter(card=>card.set.id===id).map(({id,name,localId,image})=>({id,name,localId,image}))};}
    if(type==='cards'&&!id){result=cards.map(({id,name,localId,image})=>({id,name,localId,image}));if(url.searchParams.get('rarity'))result=result.filter(row=>cards.find(card=>card.id===row.id).rarity.includes(url.searchParams.get('rarity')));}
    if(type==='cards'&&id){result=cards.find(card=>card.id===id)||null;if(lang==='ja')result=null;}
    return {ok:result!==null,status:result===null?404:200,text:async()=>JSON.stringify(result)};
  };
  const service=createCollectionCatalog({db,ApiError,fetchImpl,now:()=>clock});
  return {db,service,cards,sets,calls,fetchImpl,offline(){online=false;},advance(ms){clock+=ms;},q:query=>service.search(new URLSearchParams(query))};
}

test('busca extrai número, nome e denominador sem tratar número como identidade',()=>{
  assert.deepEqual(parseSearch('  Fleur 0166 / 165  '),{original:'Fleur 0166 / 165',name:'fleur',number:'166',printedTotal:'165',fullNumber:true});
  assert.equal(parseSearch('166').number,'166');
  assert.equal(parseSearch('spring1-166').number,null);
  assert.equal(asset('https://assets.tcgdex.net.evil.test/en/abc/1'),'');
  assert.equal(asset('https://assets.tcgdex.net/en/../secret'),'');
  assert.equal(asset('https://assets.tcgdex.net/en/abc/1?token=x'),'');
});

test('catálogo resolve colisões, aliases, ID, número local e Unicode com dados do transporte',async t=>{
  const f=await fixture(t);
  const matches=await f.q('q=166%2F165&language=pt');
  assert.equal(matches.total,2);assert.equal(matches.ambiguous,true);
  assert.deepEqual(matches.items.map(row=>row.id),['night2-166','spring1-166']);
  assert.ok(matches.warnings.some(value=>value.includes('mais de uma expansão')));
  assert.equal(matches.items[1].rarity,'Ilustração Rara');assert.equal(matches.items[1].illustrator,'Artist A');
  assert.deepEqual(matches.items[1].dexNumbers,[12]);assert.equal(matches.items[1].displayNumber,'166/165');
  assert.equal(matches.items[1].image,'https://assets.tcgdex.net/pt/spring/spring1/166/high.webp');
  assert.deepEqual(matches.items[1].availableVariants,['HOLO']);assert.equal(matches.items[1].valuation,null);
  assert.deepEqual(matches.items[1].availableLanguages,['pt']);
  assert.equal((await f.q('q=166%2F165&setId=spring1')).total,1);
  assert.equal((await f.q('q=FLEUR+166')).items[0].id,'spring1-166');
  assert.equal((await f.q('q=33%2F181')).items[0].id,'rock3-033');
  assert.equal((await f.q('q=rocher')).items[0].id,'rock3-033');
  assert.equal((await f.q('q=Shadow+Garden')).total,2);
  assert.equal((await f.q('q=Primavera+Jardim+das+Sombras+151')).total,2,'expansion alias ending in digits is not a local-number filter');
  assert.equal((await f.q('q=SPR')).total,2);
  assert.equal((await f.q('q=spring1-166')).items[0].id,'spring1-166');
  assert.equal((await f.q('q=tcgdex%3Apt%3Aspring1-166')).items[0].canonicalId,'tcgdex:pt:spring1-166');
  assert.equal((await f.q('q=166')).total,2);
  assert.equal((await f.q('q=166&rarity=Rara')).total,2);
  const page=await f.q('q=166&pageSize=1&page=2');assert.equal(page.total,2);assert.equal(page.items.length,1);assert.equal(page.page,2);assert.equal(page.hasMore,false);
  assert.ok(!(await f.q('q=Digital')).items.length,'Pocket must be excluded');
});

test('cache canônico e busca têm SQL compatível com PostgreSQL real via PGlite',async t=>{
  const f=await fixture(t,'postgres');
  const result=await f.q('q=166%2F165');assert.equal(result.total,2);
  f.service.clearMemoryCache();const calls=f.calls.length;
  const warm=await f.q('q=166%2F165');assert.equal(warm.total,2);assert.equal(f.calls.length,calls);
  assert.ok((await f.db.prepare('SELECT COUNT(*) count FROM personal_reference_cache').get()).count>=8);
});

test('primeira consulta fria recupera falha transitória sem disparar polling',async t=>{
  const f=await fixture(t);let attempts=0;
  const service=createCollectionCatalog({db:f.db,ApiError,fetchImpl:async(url,options)=>{if(new URL(url).pathname==='/v2/pt/sets'&&++attempts===1)return {ok:false,status:503};return f.fetchImpl(url,options);}});
  const result=await service.search(new URLSearchParams('q=166%2F165'));assert.equal(result.total,2);assert.equal(attempts,2);
  await service.search(new URLSearchParams('q=170%2F165'));assert.equal(attempts,2,'cache warm must not refetch the source');
});

test('cache persistente, singleflight e indisponibilidade não apagam metadados',async t=>{
  const f=await fixture(t);
  await Promise.all([f.q('q=166%2F165'),f.q('q=166%2F165')]);
  assert.equal(f.calls.filter(url=>new URL(url).pathname==='/v2/pt/cards').length,1);
  const count=f.calls.length;await f.q('q=166%2F165');assert.equal(f.calls.length,count);
  f.advance(9*86400000);f.offline();
  const result=await f.q('q=166%2F165');assert.equal(result.total,2);assert.equal(result.stale,true);assert.equal(result.items[0].metadataStale,true);assert.ok(result.items[0].image);
  await assert.rejects(f.q('q=hi&language=ko'),error=>error.status===503);
});

test('identidade e idioma exatos: não inventa impressão japonesa ou caminho externo',async t=>{
  const f=await fixture(t);
  await assert.rejects(f.service.card('spring1-166','night2','pt'),error=>error.status===404);
  await assert.rejects(f.service.card('tcgdex:pt:spring1-166','spring1','en'),error=>error.status===422);
  await assert.rejects(f.service.card('https://evil.test/card','spring1','pt'),error=>error.status===422);
  await assert.rejects(f.service.card('spring1-166','spring1','ja'),error=>error.status===404);
  assert.equal(f.calls.filter(url=>new URL(url).pathname==='/v2/ja/cards/spring1-166').length,1,'missing printing is not retried as a temporary outage');
  await assert.rejects(f.service.card('A1-166','A1','pt'),error=>error.code==='CATALOG_DIGITAL_ITEM');
});

test('selados usam metadados conhecidos sem estoque/preço comercial como avaliação',async t=>{
  const f=await fixture(t),stamp='2026-10-27T12:00:00Z';
  await f.db.prepare("INSERT INTO products(id,slug,kind,name,description,sku,tcg,set_id,set_name,images_json,attributes_json,search_text,published,created_at,updated_at) VALUES(?,?,'SEALED',?,'',?,'pokemon','spring1','Jardim das Sombras',?,'{}','etb',1,?,?)").run('sealed-known','etb-real','ETB Jardim','ETB-PT',JSON.stringify(['https://example.test/real-etb.webp']),stamp,stamp);
  await f.db.prepare("INSERT INTO products(id,slug,kind,name,description,sku,tcg,set_id,set_name,images_json,attributes_json,search_text,published,archived,created_at,updated_at) VALUES(?,?,'SEALED',?,'',?,'pokemon','spring1','Jardim das Sombras','[]','{}','etb',1,1,?,?)").run('sealed-archived','etb-archived','ETB antiga','ETB-DEMO',stamp,stamp);
  const result=await f.service.sealed(new URLSearchParams('q=etb'));assert.equal(result.total,1);assert.equal(result.items[0].sealedId,'sealed-known');assert.equal(result.items[0].valuation,null);assert.equal(result.items[0].image,'https://example.test/real-etb.webp');assert.equal('stock' in result.items[0],false);assert.equal('priceCents' in result.items[0],false);
  await f.db.prepare('UPDATE products SET images_json=?,attributes_json=? WHERE id=?').run(JSON.stringify([{url:'https://example.test/etb-object.webp',kind:'reference'}]),JSON.stringify({category:'ETB'}),'sealed-known');
  const objectImage=await f.service.sealed(new URLSearchParams('id=sealed-known'));assert.equal(objectImage.items[0].image,'https://example.test/etb-object.webp');assert.equal(objectImage.items[0].itemType,'ETB');
  assert.equal((await f.service.sealed(new URLSearchParams('id=sealed-known'))).total,1);
});
