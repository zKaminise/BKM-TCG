'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {openStore}=require('../server/store.cjs');
const {createPersonalInventory,collectionMetrics,safeImageUrl}=require('../server/personal-inventory.cjs');
class ApiError extends Error{constructor(status,code,message){super(message);Object.assign(this,{status,code});}}
const rid=()=>crypto.randomUUID();
async function fixture(t,engine){
  let pg;const pgClient=engine==='postgres'?(pg=new PGlite(),{query:async(sql,args)=>args?.length?pg.query(sql,args):(await pg.exec(sql)).at(-1),end:()=>pg.close()}):undefined;
  // PGlite has one connection. Model Pool.connect's exclusive checkout so a
  // concurrency test does not nest two independent BEGINs on that connection.
  if(pgClient){let tail=Promise.resolve();pgClient.connect=async()=>{const previous=tail;let release;tail=new Promise(resolve=>release=resolve);await previous;return {query:pgClient.query,release};};}
  const db=openStore({dbPath:':memory:',pgClient,env:{}});await db.ready;t.after(()=>db.close());
  let time=Date.parse('2026-10-20T14:00:00Z'),online=true;const users=[rid(),rid()];
  for(const user of users)await db.prepare("INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,'unusable','CUSTOMER',?)").run(user,user+'@example.invalid','Collector',new Date(time).toISOString());
  const catalog={card:async(id,setId,language)=>{if(!online)throw new ApiError(503,'CATALOG_UNAVAILABLE','offline');if(!id.startsWith(setId+'-'))throw new ApiError(404,'CARD_NOT_FOUND','wrongcard');return {id,providerId:id,provider:'tcgdex',name:'Pokémon '+id,setId,setName:'Set '+setId,number:id.split('-').at(-1),displayNumber:id.split('-').at(-1)+'/165',rarity:'Illustration Rare',illustrator:'Artist',dexNumbers:id.endsWith('TG01')?[]:[id.endsWith('170')?7:1],image:'https://assets.tcgdex.net/'+language+'/test/'+id+'/high.webp',language,referenceLanguage:language,availableVariants:['NORMAL','HOLO'],variants:{normal:true,holo:true}};}};
  const preferences=async()=>({priceTtlDays:7});
  const legacyPrices=async user=>new Map((await db.prepare('SELECT * FROM personal_prices WHERE user_id=? ORDER BY quoted_at ASC').all(user)).map(row=>[[row.card_id,row.language,row.condition,row.variant].join('|'),row]));
  const inventory=createPersonalInventory({db,ApiError,catalog,legacyPrices,preferences,now:()=>time});
  const call=async(user,method,path,body={},search='')=>(await inventory.handle(user,method,path,body,new URLSearchParams(search))).data;
  const card=(id='set151-166',overrides={})=>({kind:'CARD',itemType:'SINGLE',cardId:id,setId:id.split('-')[0],referenceLanguage:'pt',language:'pt',condition:'NM',variant:'HOLO',...overrides});
  return {db,pg,users,inventory,call,card,offline:()=>online=false,advance:ms=>time+=ms,now:()=>time};
}
for(const engine of ['sqlite','postgres'])test('Novo inventário pessoal: '+engine,async t=>{
  const f=await fixture(t,engine),[alice,bob]=f.users,call=(method,path,body={},search='')=>f.call(alice,method,path,body,search);
  let bulbasaur,squirtle,batch;
  await t.test('lote atômico por exemplar com custo/data/condição próprios e replay seguro',async()=>{
    batch={requestId:rid(),items:[f.card('set151-166',{paidCents:10000,acquiredAt:'2026-10-17',notes:'Primeira'}),f.card('set151-170',{paidCents:15000,condition:'SP',acquiredAt:'2026-10-18'})]};
    const [one,two]=await Promise.all([call('POST','/inventory/batch',batch),call('POST','/inventory/batch',batch)]);assert.deepEqual(one,two);assert.equal(one.added,2);[bulbasaur,squirtle]=one.items;
    assert.equal(bulbasaur.paidCents,10000);assert.equal(squirtle.condition,'SP');assert.equal(squirtle.acquiredAt,'2026-10-18');
    const list=await call('GET','/inventory');assert.equal(list.total,2);assert.equal(list.totals.paidCents,25000);assert.equal(list.totals.quantity,2);assert.equal(list.totals.knownValueQuantity,0);
    await assert.rejects(call('POST','/inventory/batch',{...batch,items:[f.card()]}),error=>error.status===409);
    await assert.rejects(call('POST','/inventory/batch',{items:[f.card()]}),error=>error.status===422);
    await assert.rejects(call('POST','/inventory/batch',{requestId:rid(),items:[f.card(),f.card('bad',{setId:'set151'})]}));assert.equal((await call('GET','/inventory')).total,2);
    assert.equal((await f.call(bob,'GET','/inventory')).total,0);
  });
  await t.test('null é desconhecido, zero é gratuito e referências manuais só com correspondência',async()=>{
    const result=await call('POST','/inventory/batch',{requestId:rid(),items:[f.card('set2-2',{paidCents:null}),f.card('set2-10',{paidCents:0,manualValueCents:2000}),f.card('set2-11',{paidCents:2000,manualValueCents:3000})]});
    const list=await call('GET','/inventory',{},'setId=set2');assert.equal(list.total,3);assert.equal(list.totals.paidCents,27000);assert.equal(list.totals.unknownCostQuantity,1);assert.equal(list.totals.comparableQuantity,2);assert.equal(list.totals.comparableCostCents,2000);assert.equal(list.totals.unrealizedGainCents,3000);assert.equal(list.totals.unrealizedGainPercent,150);
    const zero=result.items.find(item=>item.paidCents===0);assert.equal(zero.valuation.source,'user_manual');assert.equal(zero.valuation.match,'EXACT');assert.equal(zero.valuation.currency,'BRL');
    const edited=await call('PUT','/inventory/'+zero.id,{requestId:rid(),language:'ja'});assert.equal(edited.item.manualValueCents,null);assert.equal(edited.item.valuation,null);assert.equal(edited.item.referenceLanguage,'pt');assert.ok(edited.item.warnings.length);
    const normal=await call('PUT','/inventory/'+zero.id,{requestId:rid(),language:'pt',manualValueCents:0,manualQuotedAt:'2200-01-01T00:00:00Z'});assert.equal(normal.item.valuation.valueCents,0);assert.equal(normal.item.manualQuotedAt,new Date(f.now()).toISOString());
    const forged=await call('PUT','/inventory/'+zero.id,{requestId:rid(),manualQuotedAt:'not-a-date'});assert.equal(forged.item.manualQuotedAt,normal.item.manualQuotedAt);
    await assert.rejects(call('PUT','/inventory/'+zero.id,{requestId:rid(),quantity:2}),error=>error.status===422);
  });
  await t.test('edição idempotente vincula o ID e impede reutilização em outro exemplar',async()=>{
    const requestId=rid(),one=await call('PUT','/inventory/'+bulbasaur.id,{requestId,notes:'Detalhe privado'});assert.equal(one.item.notes,'Detalhe privado');
    assert.deepEqual(await call('PUT','/inventory/'+bulbasaur.id,{requestId,notes:'Detalhe privado'}),one);
    await assert.rejects(call('PUT','/inventory/'+squirtle.id,{requestId,notes:'Detalhe privado'}),error=>error.code==='IDEMPOTENCY_CONFLICT');
    await assert.rejects(f.call(bob,'PUT','/inventory/'+bulbasaur.id,{requestId:rid(),notes:'IDOR'}),error=>error.status===404);
    await assert.rejects(f.call(bob,'GET','/inventory/'+bulbasaur.id),error=>error.status===404);
    await assert.rejects(f.call(bob,'POST','/inventory/bulk',{requestId:rid(),action:'archive',ids:[bulbasaur.id]}),error=>error.status===404);
  });
  let sale;
  await t.test('venda por R$150 do exemplar de R$100 mantém lucro R$50 e custo histórico',async()=>{
    sale=await call('POST','/inventory/bulk',{requestId:rid(),action:'sell',ids:[bulbasaur.id],amountCents:15000,mode:'unit',exitType:'SALE',date:'2026-10-19'});
    assert.equal(sale.items[0].status,'SOLD');assert.equal(sale.items[0].sale.realizedGainCents,5000);
    let list=await call('GET','/inventory');assert.equal(list.totals.sales.realizedGainCents,5000);assert.equal(list.totals.sales.comparableQuantity,1);assert.equal(list.totals.paidCents,17000);
    await call('PUT','/inventory/'+bulbasaur.id,{requestId:rid(),paidCents:1});list=await call('GET','/inventory');assert.equal(list.totals.sales.realizedGainCents,5000);
    await assert.rejects(call('PUT','/inventory/'+bulbasaur.id,{requestId:rid(),quantity:2}),error=>error.status===422);
    await assert.rejects(call('POST','/inventory/bulk',{requestId:rid(),action:'undo',operationId:sale.operationId}),error=>error.code==='UNDO_CONFLICT');
    await call('POST','/inventory/bulk',{requestId:rid(),action:'restore',ids:[bulbasaur.id]});assert.equal((await call('GET','/inventory/'+bulbasaur.id)).item.status,'IN_COLLECTION');
  });
  await t.test('venda sem valor, doação, saída zero explícita e desfazer são distintos',async()=>{
    const result=await call('POST','/inventory/batch',{requestId:rid(),items:[f.card('set3-1',{paidCents:1000}),f.card('set3-1',{paidCents:500,condition:'SP'}),f.card('set3-2')]});
    const unknown=await call('POST','/inventory/bulk',{requestId:rid(),action:'sell',ids:[result.items[0].id],amountCents:null,exitType:'TRADE'});assert.equal(unknown.items[0].sale.amountCents,null);assert.equal(unknown.items[0].sale.realizedGainCents,null);
    const zero=await call('POST','/inventory/bulk',{requestId:rid(),action:'sell',ids:[result.items[1].id],amountCents:0});assert.equal(zero.items[0].sale.realizedGainCents,-500);
    await assert.rejects(call('POST','/inventory/bulk',{requestId:rid(),action:'sell',ids:[result.items[2].id],amountCents:0,exitType:'DONATION'}),error=>error.status===422);
    const undo={requestId:rid(),action:'undo',operationId:unknown.operationId},back=await call('POST','/inventory/bulk',undo);assert.equal(back.items[0].status,'IN_COLLECTION');assert.deepEqual(await call('POST','/inventory/bulk',undo),back);
    assert.equal((await call('GET','/inventory',{},'status=SOLD')).total,1);
  });
  await t.test('arquivar/restaurar/desfazer preserva item, custo e trilha; atualização posterior impede undo',async()=>{
    const archived=await call('POST','/inventory/bulk',{requestId:rid(),action:'archive',ids:[squirtle.id]});assert.equal(archived.items[0].status,'ARCHIVED');
    assert.equal((await call('GET','/inventory',{},'status=ARCHIVED')).total,1);
    await call('POST','/inventory/bulk',{requestId:rid(),action:'undo',operationId:archived.operationId});
    const detail=await call('GET','/inventory/'+squirtle.id);assert.equal(detail.item.paidCents,15000);assert.equal(detail.item.status,'IN_COLLECTION');assert.ok(detail.events.some(event=>event.kind==='ARCHIVE'));assert.ok(detail.events.some(event=>event.kind==='UNDO'));
    assert.ok((await call('GET','/inventory/events')).items.length);
  });
  await t.test('total de lote distribui cada centavo, sem transformar total em valor unitário',async()=>{
    const created=await call('POST','/inventory/batch',{requestId:rid(),items:[f.card('set4-1',{quantity:3})]});assert.equal(created.items.length,3);
    const ids=created.items.map(item=>item.id),cost=await call('POST','/inventory/bulk',{requestId:rid(),action:'cost',ids,mode:'total',paidCents:100});assert.deepEqual(cost.items.map(item=>item.paidCents).sort(),[33,33,34]);
    const sold=await call('POST','/inventory/bulk',{requestId:rid(),action:'sell',ids,mode:'total',amountCents:200});assert.equal(sold.items.reduce((sum,item)=>sum+item.sale.amountCents,0),200);assert.equal(sold.items.reduce((sum,item)=>sum+item.sale.realizedGainCents,0),100);
    const unchanged=(await call('GET','/inventory/'+squirtle.id)).item.acquiredAt;await call('POST','/inventory/bulk',{requestId:rid(),action:'cost',ids:[squirtle.id],paidCents:null});assert.equal((await call('GET','/inventory/'+squirtle.id)).item.acquiredAt,unchanged);
  });
  await t.test('lote legado mantém cinco unidades; venda parcial de uma e undo preservam as outras quatro',async()=>{
    const id=rid(),time=new Date(f.now()).toISOString();await f.db.prepare('INSERT INTO personal_lots(id,user_id,set_id,card_id,language,condition,variant,quantity,paid_cents,metadata_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,alice,'legacy','legacy-2','pt','NM','NORMAL',5,123,JSON.stringify({id:'legacy-2',name:'Legado',number:'2',setName:'Expansão antiga',rarity:'Rare',illustrator:'Classic'}),time,time);
    const moved=await call('POST','/inventory/bulk',{requestId:rid(),action:'sell',ids:[id],quantities:{[id]:1},amountCents:200});assert.equal(moved.items.find(item=>item.id===id).quantity,4);assert.equal(moved.items.find(item=>item.status==='SOLD').sale.costCents,123);
    const restored=await call('POST','/inventory/bulk',{requestId:rid(),action:'undo',operationId:moved.operationId});assert.equal(restored.items.length,1);assert.equal(restored.items[0].id,id);assert.equal(restored.items[0].quantity,5);
    const filtered=await call('GET','/inventory',{},'setId=legacy&rarity=Rare&group=illustrator');assert.equal(filtered.total,1);assert.equal(filtered.facets.sets.find(set=>set.id==='legacy').name,'Expansão antiga');assert.equal(filtered.groups[0].quantity,5);
  });
  await t.test('paginação e filtros no SQL; layouts compartilham resultado; null sempre por último',async()=>{
    await call('POST','/inventory/batch',{requestId:rid(),items:[f.card('sort-2',{paidCents:0,manualValueCents:1000}),f.card('sort-10',{paidCents:1000}),f.card('sort-TG01',{paidCents:null})]});
    const byNumber=await call('GET','/inventory',{},'setId=sort&sort=number&dir=asc&pageSize=1');assert.equal(byNumber.items[0].card.number,'2');assert.equal(byNumber.total,3);assert.equal(byNumber.items.length,1);
    const next=await call('GET','/inventory',{},'setId=sort&sort=number&dir=asc&pageSize=1&page=2');assert.equal(next.items[0].card.number,'10');
    const descending=await call('GET','/inventory',{},'setId=sort&sort=cost&dir=desc');assert.equal(descending.items.at(-1).paidCents,null);
    assert.equal((await call('GET','/inventory',{},'setId=sort&price=known')).total,1);
    assert.equal((await call('GET','/inventory',{},'q=sort&cost=missing')).total,1);
    assert.equal((await call('GET','/inventory',{},'setId=sort&minCost=0&maxCost=0')).total,1);
    for(const group of ['set','pokemon','rarity','illustrator','status']){const result=await call('GET','/inventory',{},'setId=sort&pageSize=1&group='+group);assert.equal(result.groups.reduce((sum,row)=>sum+row.quantity,0),3);}
  });
  await t.test('selados catalogados e manuais mais personalizado persistem sem tocar estoque da loja',async()=>{
    const product=rid(),time=new Date(f.now()).toISOString();await f.db.prepare("INSERT INTO products(id,slug,kind,name,description,sku,tcg,set_id,set_name,images_json,search_text,published,created_at,updated_at) VALUES(?,?,'SEALED','ETB real','Teste',?,'pokemon','set151','151','[]','etb',1,?,?)").run(product,'etb-'+product,'ETB-'+product,time,time);
    const mixed=await call('POST','/inventory/batch',{requestId:rid(),items:[{kind:'SEALED',itemType:'ETB',sealedId:product,condition:'SEALED',paidCents:50000},{kind:'SEALED',itemType:'BOOSTER',title:'Booster manual',condition:'OPENED',paidCents:0},{kind:'CUSTOM',itemType:'ACCESSORY',title:'Playmat',description:'Particular',photoUrl:'https://images.example.com/playmat.png',manualValueCents:2000,paidCents:null}]});
    assert.equal(mixed.added,3);assert.equal(mixed.items[0].card.name,'ETB real');assert.equal(mixed.items[0].valuation,null);assert.equal(mixed.items[2].card.provider,'user');assert.equal(mixed.items[2].valuation.sourceLabel,'Informado por você');assert.equal((await f.db.prepare('SELECT COUNT(*) count FROM variants WHERE product_id=?').get(product)).count,0);
    await f.db.prepare('UPDATE products SET published=0,archived=1 WHERE id=?').run(product);
    const afterArchive=await call('PUT','/inventory/'+mixed.items[0].id,{requestId:rid(),sealedId:product,notes:'Ainda possuo esta ETB'});
    assert.equal(afterArchive.item.notes,'Ainda possuo esta ETB');assert.equal(afterArchive.item.card.name,'ETB real');assert.equal(afterArchive.item.card.sealedId,product);assert.equal(afterArchive.item.paidCents,50000);
    const editWithoutSelection=await call('PUT','/inventory/'+mixed.items[0].id,{requestId:rid(),paidCents:51000});assert.equal(editWithoutSelection.item.card.sealedId,product);assert.equal(editWithoutSelection.item.paidCents,51000);
    await assert.rejects(call('POST','/inventory/batch',{requestId:rid(),items:[{kind:'SEALED',itemType:'ETB',sealedId:product,condition:'SEALED'}]}),error=>error.code==='SEALED_NOT_FOUND');
    await assert.rejects(call('POST','/inventory/batch',{requestId:rid(),items:[{kind:'CUSTOM',title:'Fake',cardId:'set151-166'}]}),error=>error.status===422);
    await assert.rejects(call('POST','/inventory/batch',{requestId:rid(),items:[{kind:'CUSTOM',title:'Unsafe',photoUrl:'https://127.0.0.1/x.png'}]}),error=>error.status===422);
  });
  await t.test('stale não entra no patrimônio; offline não perde identidade; excluir requer confirmação',async()=>{
    f.advance(8*86400000);f.offline();const list=await call('GET','/inventory');assert.equal(list.totals.estimatedValueCents,0);assert.ok(list.totals.staleQuantity>0);
    const detail=await call('GET','/inventory/'+squirtle.id);assert.ok(detail.item.card.image);const edited=await call('PUT','/inventory/'+squirtle.id,{requestId:rid(),notes:'Mesmo offline'});assert.equal(edited.item.notes,'Mesmo offline');
    await assert.rejects(call('DELETE','/inventory/'+squirtle.id,{}),error=>error.status===422);
    await assert.rejects(f.call(bob,'DELETE','/inventory/'+squirtle.id,{confirmation:'EXCLUIR'}),error=>error.status===404);
    const removed=await call('DELETE','/inventory/'+squirtle.id,{confirmation:'EXCLUIR',requestId:rid()});assert.equal(removed.removed,true);await assert.rejects(call('GET','/inventory/'+squirtle.id),error=>error.status===404);
    assert.ok((await call('GET','/inventory/events')).items.some(event=>event.kind==='DELETE'));
  });
});
for(const engine of ['sqlite','postgres'])test('Agrupar selado manual não associa item sem coleção à sua linha: '+engine,async t=>{
  const f=await fixture(t,engine),[owner]=f.users;
  await f.call(owner,'POST','/inventory/batch',{requestId:rid(),items:[{kind:'SEALED',itemType:'ETB',title:'ETB 151',setName:'Pokémon 151',condition:'SEALED',paidCents:0},{kind:'CUSTOM',itemType:'CUSTOM',title:'Playmat',condition:'CUSTOM',paidCents:null}]});
  const data=await f.call(owner,'GET','/inventory',{},'group=set');
  assert.equal(data.groups.length,2);
  assert.deepEqual(data.groups.map(group=>[group.key,group.quantity]).sort(),[['manual:Pokémon 151',1],['unknown',1]]);
  assert.equal(data.groups.find(group=>group.key==='unknown').label,'Sem informação');
});

test('financeiro puro não inventa custo/preço e divisão por zero não produz infinito',()=>{
  const totals=collectionMetrics([{kind:'CARD',cardId:'a',referenceLanguage:'pt',quantity:1,status:'IN_COLLECTION',paidCents:null,valuation:null},{kind:'CARD',cardId:'b',referenceLanguage:'pt',quantity:1,status:'IN_COLLECTION',paidCents:0,valuation:{valueCents:100,currency:'BRL',match:'EXACT',stale:false}},{kind:'CARD',cardId:'c',referenceLanguage:'pt',quantity:1,status:'IN_COLLECTION',paidCents:2000,valuation:null}]);
  assert.equal(totals.paidCents,2000);assert.equal(totals.unknownCostQuantity,1);assert.equal(totals.unrealizedGainPercent,null);assert.equal(totals.unrealizedGainCents,100);assert.equal(totals.knownValueQuantity,1);
});
test('URL de foto não aceita credenciais, rede privada, protocolos ativos ou caminhos arbitrários',()=>{
  for(const bad of ['javascript:alert(1)','http://example.com/x','https://user:pass@example.com/x','https://127.1/x','https://10.0.0.1/x','https://[::1]/x','https://localhost/x','/etc/passwd','/uploads/../private','/uploads/%2e%2e/a'])assert.throws(()=>safeImageUrl(bad));
  assert.equal(safeImageUrl('https://images.example.com/x.png'),'https://images.example.com/x.png');
});
