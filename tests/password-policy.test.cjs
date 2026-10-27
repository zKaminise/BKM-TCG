'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path');
const {once}=require('node:events'),{pathToFileURL}=require('node:url');
const {PASSWORD_POLICY,passwordValidation}=require('../server/password-policy.cjs');
const {hashPassword,hashToken}=require('../server/auth.cjs');
const {createServer}=require('../serve.cjs');
const cases=[
  ['8 caracteres','Abcdefg1',false],['9 sem símbolo','Abcdefgh1',true],['14 sem símbolo','Abcdefghijklm1',true],['15 caracteres','Abcdefghijklmn1',false],
  ['só minúsculas','abcdefg12',false],['sem número','Abcdefghi',false],['9 letras sem dígito','ABCDEFGHI',false],['símbolo opcional','Abcdefg1!',true],
  ['não exige minúscula','ABCDEFGH1',true],['maiúscula tem de ser A–Z','Ábcdefg12',false],['9 caracteres Unicode','A1'+'😀'.repeat(7),true],['14 caracteres Unicode','A1'+'😀'.repeat(12),true],['15 caracteres Unicode','A1'+'😀'.repeat(13),false],['sem requisito oculto de espaços','A1      x',true]
];
test('política exata 9–14: composição declarada, símbolos opcionais e paridade client/servidor',async()=>{
  const {clientPasswordValidation}=await import(pathToFileURL(path.resolve(__dirname,'../password-ui.js')).href);
  assert.equal(PASSWORD_POLICY.minLength,9);assert.equal(PASSWORD_POLICY.maxLength,14);
  for(const [name,password,valid]of cases){const server=passwordValidation(password),client=clientPasswordValidation(password,PASSWORD_POLICY);assert.equal(server.valid,valid,name);assert.equal(client.valid,valid,name);assert.deepEqual(client.errors,server.errors,name);}
  assert.ok(passwordValidation('abcdefgh1').message.includes('maiúscula'));
  assert.ok(passwordValidation('Abcdefghi').message.includes('número'));
  assert.ok(passwordValidation('Abcdefg1').message.includes('9 a 14'));
});
async function fixture(t){
  const server=createServer({dbPath:':memory:',databaseUrl:'',publicUrl:'http://localhost:4182',env:{BKM_ENVIRONMENT:'demo',PAYMENT_PROVIDER:'disabled',EMAIL_PROVIDER:'development'}});
  await server.api.ready;server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await server.api.close();});
  const base='http://127.0.0.1:'+server.address().port,db=server.api.asyncStore;
  class Client{
    cookie='';csrf='';
    async call(route,method='GET',body){const response=await fetch(base+'/api'+route,{method,headers:{Origin:'http://localhost:4182',...(this.cookie?{Cookie:this.cookie}:{}),...(body?{'Content-Type':'application/json','X-CSRF-Token':this.csrf}:{})},...(body?{body:JSON.stringify(body)}:{})});const cookie=response.headers.get('set-cookie');if(cookie)this.cookie=cookie.split(';')[0];const data=await response.json();if(data.csrfToken)this.csrf=data.csrfToken;return{status:response.status,data};}
    async init(){assert.equal((await this.call('/session')).status,200);return this;}
  }
  async function seed(password='Legacy77'){const id=crypto.randomUUID(),email=id+'@example.invalid',hash=await hashPassword(password);await db.prepare("INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,'CUSTOMER',?)").run(id,email,'Teste de senha',hash,new Date().toISOString());return{id,email,hash,password};}
  async function token(user){const value=crypto.randomBytes(30).toString('base64url');await db.prepare('INSERT INTO password_resets(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(hashToken(value),user.id,Date.now()+600000,new Date().toISOString());return value;}
  return{db,Client,seed,token};
}
test('cadastro HTTP usa o contrato público e rejeita os limites sem relaxar o servidor',async t=>{
  const f=await fixture(t),client=await new f.Client().init(),config=await client.call('/config');assert.deepEqual(config.data.passwordPolicy,PASSWORD_POLICY);
  let n=0;for(const [name,password,valid]of cases){const response=await client.call('/auth/register','POST',{email:'password-'+(++n)+'@example.invalid',name:'Teste de cadastro',password});assert.equal(response.status,valid?201:422,name);if(!valid)assert.equal(response.data.error.message,passwordValidation(password).message,name);}
  const mismatch=await client.call('/auth/register','POST',{email:'mismatch@example.invalid',name:'Teste',password:'Abcdefgh1',confirmPassword:'Different1'});assert.equal(mismatch.status,422);assert.match(mismatch.data.error.message,/iguais/);
});
test('login legado não muda hash nem exige a composição nova; recuperação permanece genérica',async t=>{
  const f=await fixture(t),client=await new f.Client().init();
  for(const password of ['oldpass8','very-long-legacy-password']){const user=await f.seed(password);const login=await client.call('/auth/login','POST',{email:user.email,password});assert.equal(login.status,200);assert.equal((await f.db.prepare('SELECT password_hash FROM users WHERE id=?').get(user.id)).password_hash,user.hash);assert.match(user.hash,/^scrypt\$32768\$8\$1\$/);}
  const local=await f.seed(),known=await client.call('/auth/forgot-password','POST',{email:local.email}),unknown=await client.call('/auth/forgot-password','POST',{email:'unknown@example.invalid'});assert.equal(known.status,202);assert.deepEqual(known.data,unknown.data);
});
test('redefinição por e-mail valida 8/15/composição, confirma igualdade, aceita 9/14 e invalida o token',async t=>{
  const f=await fixture(t),user=await f.seed(),client=await new f.Client().init();let token=await f.token(user);
  for(const password of ['Abcdefg1','Abcdefghijklmn1','abcdefgh1','Abcdefghi']){const response=await client.call('/auth/reset-password','POST',{token,password});assert.equal(response.status,422);assert.equal((await f.db.prepare('SELECT password_hash FROM users WHERE id=?').get(user.id)).password_hash,user.hash);}
  assert.equal((await client.call('/auth/reset-password','POST',{token,password:'Abcdefgh1',confirmPassword:'Different1'})).status,422);
  assert.equal((await client.call('/auth/reset-password','POST',{token,password:'Abcdefgh1'})).status,200);
  assert.equal((await client.call('/auth/reset-password','POST',{token,password:'Abcdefgh1'})).data.error.code,'RESET_INVALID');
  token=await f.token(user);assert.equal((await client.call('/auth/reset-password','POST',{token,password:'Abcdefghijklm1'})).status,200);
  assert.equal((await client.call('/auth/login','POST',{email:user.email,password:'Abcdefghijklm1'})).status,200);
});
test('alteração de senha mantém verificação da atual, revoga sessões e aplica os mesmos limites',async t=>{
  const f=await fixture(t),user=await f.seed(),client=await new f.Client().init();assert.equal((await client.call('/auth/login','POST',{email:user.email,password:user.password})).status,200);
  for(const password of ['Abcdefg1','Abcdefghijklmn1','abcdefgh1'])assert.equal((await client.call('/account/security/password','POST',{currentPassword:user.password,password})).status,422);
  assert.equal((await client.call('/account/security/password','POST',{currentPassword:'wrong',password:'Abcdefgh1'})).status,401);
  const changed=await client.call('/account/security/password','POST',{currentPassword:user.password,password:'Abcdefgh1',confirmPassword:'Abcdefgh1'});assert.equal(changed.status,200);assert.ok(changed.data.csrfToken);assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id=?').get(user.id)).n,1);
});
