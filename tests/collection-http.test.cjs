const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {once}=require('node:events');
const {createServer}=require('../serve.cjs');
const baseRoute='/api/account/collection/inventory';
async function fixture(t){
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'bkm-collection-http-'));
  assert.ok(path.resolve(folder).startsWith(path.resolve(os.tmpdir())+path.sep));
  const origin='http://localhost:4182';
  const server=createServer({root:path.resolve(__dirname,'..'),dbPath:path.join(folder,'qa.sqlite'),databaseUrl:'',publicUrl:origin,env:{BKM_ENVIRONMENT:'demo',PAYMENT_PROVIDER:'mock',EMAIL_PROVIDER:'development'},catalogFetch:async()=>{throw new Error('No external API in HTTP isolation tests');}});
  await server.api.ready;server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await server.api.close();fs.rmSync(folder,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port;
  class Client{
    cookie='';csrf='';
    async call(route,method='GET',data,extra={}){
      const response=await fetch(base+route,{method,redirect:'manual',headers:{Origin:origin,...(this.cookie?{Cookie:this.cookie}:{}),...(data===undefined?{}:{'Content-Type':'application/json','X-CSRF-Token':this.csrf}),...extra},...(data===undefined?{}:{body:JSON.stringify(data)})});
      const cookie=response.headers.get('set-cookie');if(cookie)this.cookie=cookie.split(';')[0];
      const raw=await response.text(),json=response.headers.get('content-type')?.includes('application/json');
      const body=json&&raw?JSON.parse(raw):raw;if(body?.csrfToken)this.csrf=body.csrfToken;
      return {status:response.status,headers:response.headers,body};
    }
    async init(){assert.equal((await this.call('/api/session')).status,200);return this;}
    async register(email){await this.init();assert.equal((await this.call('/api/auth/register','POST',{name:'Colecionador HTTP',email,password:'Collect12345'})).status,201);return this;}
  }
  return {server,base,Client};
}
test('Minha Coleção HTTP: sessão, CSRF, transação, replay, isolamento, exclusão confirmada e novo login',async t=>{
  const f=await fixture(t),anonymous=await new f.Client().init();
  assert.equal((await anonymous.call(baseRoute)).status,401);
  const a=await new f.Client().register('collection-http-a@example.invalid'),b=await new f.Client().register('collection-http-b@example.invalid');
  const batch={requestId:'http-collection-batch-001',items:[null,0,2000].map((paidCents,i)=>({kind:'CUSTOM',itemType:'CUSTOM',title:'Playmat '+i,condition:'CUSTOM',language:'pt',paidCents,manualValueCents:null}))};
  assert.equal((await a.call(baseRoute+'/batch','POST',batch,{'X-CSRF-Token':'invalid'})).status,403);
  assert.equal((await a.call(baseRoute+'/batch','POST',batch,{Origin:'https://other.example.invalid'})).status,403);
  assert.equal((await a.call(baseRoute+'/batch','POST',batch)).status,201);
  let list=await a.call(baseRoute);assert.equal(list.status,200);assert.equal(list.body.total,3);
  assert.equal(list.headers.get('cache-control'),'no-store');
  assert.deepEqual(list.body.items.map(x=>x.paidCents).sort((x,y)=>x===null?-1:y===null?1:x-y),[null,0,2000]);
  const replay=await a.call(baseRoute+'/batch','POST',batch);assert.equal(replay.status,201);assert.equal((await a.call(baseRoute)).body.total,3);
  assert.equal((await a.call(baseRoute+'/batch','POST',{...batch,items:[{...batch.items[0],title:'Changed payload'}]})).status,409);
  assert.equal((await a.call(baseRoute+'/batch','POST',{requestId:'http-collection-invalid',items:[batch.items[0],{...batch.items[0],paidCents:-1}]})).status,422);
  assert.equal((await a.call(baseRoute)).body.total,3);
  const id=list.body.items[0].id;
  assert.equal((await b.call(baseRoute)).body.total,0);
  for(const [method,data]of[['GET',undefined],['PUT',{title:'Foreign mutation',userId:'forged'}],['DELETE',{confirmation:'EXCLUIR'}]])assert.equal((await b.call(baseRoute+'/'+id,method,data)).status,404);
  assert.equal((await a.call(baseRoute+'/'+id,'DELETE',{})).status,422);
  assert.equal((await a.call(baseRoute+'/'+id,'GET')).body.item.id,id);
  assert.equal((await a.call(baseRoute+'/'+id,'DELETE',{confirmation:'EXCLUIR'})).status,200);
  assert.equal((await a.call(baseRoute)).body.total,2);
  assert.equal((await a.call('/api/auth/logout','POST',{})).status,200);await a.init();
  assert.equal((await a.call('/api/auth/login','POST',{email:'collection-http-a@example.invalid',password:'Collect12345'})).status,200);
  assert.equal((await a.call(baseRoute)).body.total,2);
  assert.equal((await b.call(baseRoute)).body.total,0);
});
test('Minha Coleção: módulos públicos empacotados sem expor código servidor',async t=>{
  const f=await fixture(t),client=new f.Client();
  for(const [asset,type]of[['collection-ui.js','javascript'],['collection-domain.js','javascript'],['collection.css','css']]){
    const response=await client.call('/'+asset);assert.equal(response.status,200,asset);assert.ok(response.headers.get('content-type').includes(type));assert.ok(response.body.length>100);
  }
  assert.equal((await client.call('/server/collection-inventory.cjs')).status,404);
  assert.equal((await client.call('/.env')).status,404);
});
