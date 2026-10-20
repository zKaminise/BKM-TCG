const test=require('node:test');
const assert=require('node:assert/strict');
const {once}=require('node:events');
const {createServer}=require('../serve.cjs');
const {allowedOrigins,safeReturnPath}=require('../server/domain-policy.cjs');
test('origens oficiais explícitas sem wildcard e redirects locais seguros',()=>{
  assert.deepEqual(allowedOrigins({publicUrl:'https://lojabkm.com.br'}),['https://lojabkm.com.br','https://www.lojabkm.com.br','https://bkm-tcg-demo.vercel.app']);
  assert.deepEqual(allowedOrigins({publicUrl:'http://localhost:4173'}),['http://localhost:4173']);
  for(const value of ['//evil.test','/\\evil.test','https://evil.test','/api/auth/logout','/\nfoo'])assert.equal(safeReturnPath(value),'/conta');
  assert.equal(safeReturnPath('/checkout?step=2'),'/checkout?step=2');
});
test('cadastro oficial mantém CSRF; endereços e senha pertencem somente ao usuário',async t=>{
  const server=createServer({dbPath:':memory:',databaseUrl:'',publicUrl:'https://lojabkm.com.br',env:{BKM_ENVIRONMENT:'demo',PAYMENT_PROVIDER:'disabled'}});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port;
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  class Client {
    cookie='';csrf='';
    async call(path,method='GET',body,origin='https://lojabkm.com.br'){
      const res=await fetch(base+'/api'+path,{method,headers:{origin,cookie:this.cookie,'x-csrf-token':this.csrf,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
      const cookie=res.headers.get('set-cookie');if(cookie)this.cookie=cookie.split(';')[0];
      const data=await res.json();if(data.csrfToken)this.csrf=data.csrfToken;
      return {status:res.status,data};
    }
    async register(email){await this.call('/session');return this.call('/auth/register','POST',{email,name:'Teste privado',password:'test-long-password'},'https://www.lojabkm.com.br');}
  }
  const a=new Client(),b=new Client();
  assert.equal((await a.register('a@profile.test')).status,201);assert.equal((await b.register('b@profile.test')).status,201);
  assert.equal((await a.call('/account/profile','PUT',{name:'Teste'},'https://lojabkm.com.br.evil.test')).status,403);
  const oldCsrf=a.csrf;a.csrf='invalid';assert.equal((await a.call('/account/profile','PUT',{name:'Teste'})).status,403);a.csrf=oldCsrf;
  const address={label:'Casa',recipient:'Teste',zip:'01001000',street:'Praça da Sé',number:'1',district:'Sé',city:'São Paulo',state:'SP',default:true};
  const created=await a.call('/account/addresses','POST',address);assert.equal(created.status,201);const id=created.data.item.id;
  assert.equal((await b.call('/account/addresses')).data.items.length,0);
  assert.equal((await b.call('/account/addresses/'+id,'PUT',address)).status,404);
  assert.equal((await b.call('/account/addresses/'+id,'DELETE')).status,404);
  assert.equal((await a.call('/account/profile','PUT',{name:'Novo nome',phone:'11999999999'})).status,200);
  assert.equal((await a.call('/account/addresses')).data.items[0].id,id);
  assert.equal((await a.call('/account/security/password','POST',{currentPassword:'wrong',password:'new-long-password'})).status,401);
  const second=new Client();await second.call('/session');assert.equal((await second.call('/auth/login','POST',{email:'a@profile.test',password:'test-long-password'})).status,200);
  assert.equal((await a.call('/account/security/password','POST',{currentPassword:'test-long-password',password:'new-long-password'})).status,200);
  assert.equal((await second.call('/account/addresses')).status,401);
  assert.equal((await a.call('/account/addresses')).status,200);
});
