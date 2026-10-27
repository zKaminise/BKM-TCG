const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {once}=require('node:events');
const {PGlite}=require('@electric-sql/pglite');
const {createServer}=require('../serve.cjs'),{hashPassword}=require('../server/auth.cjs');
async function fixture(t,{engine='sqlite',environment='production'}={}){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'bkm-catalog-archive-'));let pgClient;
  if(engine==='postgres'){const pg=new PGlite();pgClient={query:async(sql,args)=>args?.length?pg.query(sql,args):(await pg.exec(sql)).at(-1),end:()=>pg.close()};}
  const server=createServer({root:directory,dbPath:path.join(directory,'isolated.sqlite'),databaseUrl:'',pgClient,env:{BKM_ENVIRONMENT:environment,PAYMENT_PROVIDER:'disabled',EMAIL_PROVIDER:'disabled'}});
  await server.api.ready;server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await server.api.close();fs.rmSync(directory,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port,db=server.api.asyncStore,stamp=new Date().toISOString();
  await db.prepare("INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,'ADMIN',?)").run(crypto.randomUUID(),'archive@example.test','Administrador isolado',await hashPassword('archive-fixture-password'),stamp);
  class Client{cookie='';csrf='';async call(route,{method='GET',body}={}){const response=await fetch(base+route,{method,headers:{...(this.cookie?{cookie:this.cookie}:{}),...(this.csrf?{'x-csrf-token':this.csrf}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});if(response.headers.get('set-cookie'))this.cookie=response.headers.get('set-cookie').split(';')[0];const data=await response.json();if(data.csrfToken)this.csrf=data.csrfToken;return {status:response.status,data};}}
  const admin=new Client(),anon=new Client();await admin.call('/api/session');assert.equal((await admin.call('/api/auth/login',{method:'POST',body:{email:'archive@example.test',password:'archive-fixture-password'}})).status,200);
  const product=(suffix,extra={})=>({kind:'SEALED',name:'Produto '+suffix,slug:'archive-'+suffix.toLowerCase(),sku:'REAL-'+suffix,description:'Somente banco descartável de teste.',setId:'archive-set',setName:'Coleção isolada',images:[{url:'/assets/pack.webp',kind:'actual'}],published:true,variants:[{language:'pt',condition:'SEALED',finish:'NORMAL',priceCents:2500,stock:2}],...extra});
  return {admin,anon,db,product};
}
for(const engine of ['sqlite','postgres'])test(`catálogo ${engine}: arquivo exige filtro admin explícito e nunca aparece pela API pública`,async t=>{
  const {admin,anon,db,product}=await fixture(t,{engine});
  const create=async(suffix,extra)=>{const response=await admin.call('/api/admin/products',{method:'POST',body:product(suffix,extra)});assert.equal(response.status,201,JSON.stringify(response.data));return response.data;};
  const archived=await create('ARCHIVED'),live=await create('LIVE'),draft=await create('DRAFT',{published:false});
  assert.equal((await admin.call('/api/admin/products/'+archived.id,{method:'DELETE'})).status,200);
  assert.ok(await db.prepare('SELECT id FROM products WHERE id=?').get(archived.id),'arquivar preserva o registro para o histórico');
  const normal=(await admin.call('/api/admin/products')).data;assert.equal(normal.pagination.total,2);assert.deepEqual(new Set(normal.items.map(row=>row.id)),new Set([live.id,draft.id]));
  const all=(await admin.call('/api/admin/products?archived=all')).data;assert.equal(all.pagination.total,3);assert.equal(all.items.find(row=>row.id===archived.id).archived,true);
  const only=(await admin.call('/api/admin/products?archived=only&pageSize=1')).data;assert.equal(only.pagination.total,1);assert.equal(only.items[0].id,archived.id);
  const detail=await admin.call('/api/admin/products/'+archived.id);assert.equal(detail.status,200);assert.equal(detail.data.archived,true);
  for(const suffix of ['', '?archived=all','?archived=only']){const response=await anon.call('/api/products'+suffix);assert.equal(response.status,200);assert.equal(response.data.pagination.total,1);assert.equal(response.data.items[0].id,live.id);}
  assert.equal((await anon.call('/api/products/'+archived.slug)).status,404);assert.equal((await anon.call('/api/products/'+draft.slug)).status,404);
  for(const suffix of ['?archived=no','?archived=','?archived=all&archived=only']){assert.equal((await admin.call('/api/admin/products'+suffix)).status,422);assert.equal((await anon.call('/api/products'+suffix)).status,422);}
  assert.equal((await anon.call('/api/admin/products?archived=all')).status,401);
});
for(const environment of ['production','staging'])test(`${environment}: produto demonstrativo não pode ser publicado e marcador persiste após edição/renomeação`,async t=>{
  const {admin,db,product}=await fixture(t,{environment});
  for(const extra of [{sku:'DEMO-ITEM'},{sku:'demo_item'},{attributes:{demo:true}}]){
    const response=await admin.call('/api/admin/products',{method:'POST',body:product('BLOCKED',extra)});assert.equal(response.status,409);assert.equal(response.data.error.code,'DEMO_PRODUCT_PUBLISH_BLOCKED');
  }
  assert.equal(Number((await db.prepare('SELECT COUNT(*) n FROM products').get()).n),0);
  assert.equal(Number((await db.prepare('SELECT COUNT(*) n FROM stock_movements').get()).n),0);
  const draft=await admin.call('/api/admin/products',{method:'POST',body:product('OLD',{sku:'DEMO-OLD',published:false})});assert.equal(draft.status,201);assert.equal(draft.data.attributes.demo,true);
  const rename=await admin.call('/api/admin/products/'+draft.data.id,{method:'PUT',body:{...draft.data,sku:'REAL-RENAMED',attributes:{},published:false}});assert.equal(rename.status,200);assert.equal(rename.data.attributes.demo,true);
  const publish=await admin.call('/api/admin/products/'+draft.data.id,{method:'PUT',body:{...rename.data,attributes:{demo:false},published:true}});assert.equal(publish.status,409);assert.equal(publish.data.error.code,'DEMO_PRODUCT_PUBLISH_BLOCKED');
  assert.equal((await db.prepare('SELECT published FROM products WHERE id=?').get(draft.data.id)).published,0);
  const real=await admin.call('/api/admin/products',{method:'POST',body:product('NEW')});assert.equal(real.status,201);assert.equal(real.data.published,true);
});
test('demo dedicado mantém publicação de fixtures para homologação visual',async t=>{
  const {admin,product}=await fixture(t,{environment:'demo'});const response=await admin.call('/api/admin/products',{method:'POST',body:product('DEMO',{sku:'DEMO-VISUAL',attributes:{demo:true}})});assert.equal(response.status,201);assert.equal(response.data.published,true);assert.equal(response.data.attributes.demo,true);
});
