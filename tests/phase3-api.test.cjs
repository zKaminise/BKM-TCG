const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {once}=require('node:events');
const {createServer}=require('../serve.cjs');
const {hashPassword}=require('../server/auth.cjs');
const signing=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...signing.publicKey.export({format:'jwk'}),kid:'phase3-fixture',use:'sig',alg:'RS256'};
const origin='https://lojabkm.com.br';
async function fixture(t){
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'bkm-phase3-api-'));assert.ok(path.resolve(folder).startsWith(path.resolve(os.tmpdir())+path.sep));
  const env={BKM_ENVIRONMENT:'demo',HOSTING_DEMO_ONLY:'true',PAYMENT_PROVIDER:'mock',EMAIL_PROVIDER:'development',BKM_PUBLIC_URL:origin,GOOGLE_AUTH_ENABLED:'true',GOOGLE_CLIENT_ID:'phase3-fixture.apps.googleusercontent.com',GOOGLE_CLIENT_SECRET:'fixture-google-secret-not-usable',RESEND_WEBHOOK_SECRET:'whsec_'+Buffer.from('phase3-test-only-svix-key-32bytes').toString('base64')};
  let claims,providerCalls=0;const webhookDates=new Map();
  const googleFetch=async url=>{providerCalls++;if(url.endsWith('/certs'))return new Response(JSON.stringify({keys:[jwk]}));assert.equal(url,'https://oauth2.googleapis.com/token');const parts=[{alg:'RS256',kid:jwk.kid},claims].map(item=>Buffer.from(JSON.stringify(item)).toString('base64url'));return new Response(JSON.stringify({id_token:parts.join('.')+'.'+crypto.sign('RSA-SHA256',Buffer.from(parts.join('.')),signing.privateKey).toString('base64url')}));};
  const server=createServer({root:folder,dbPath:path.join(folder,'isolated.sqlite'),databaseUrl:'',publicUrl:origin,env,googleFetch});await server.api.ready;server.listen(0,'127.0.0.1');await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port,db=server.api.asyncStore;
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await server.api.close();fs.rmSync(folder,{recursive:true,force:true});});
  class Client{
    cookie='';csrf='';
    async call(route,method='GET',data,headers={}){const res=await fetch(base+route,{method,redirect:'manual',headers:{Origin:origin,...(this.cookie?{Cookie:this.cookie}:{}),...(data?{'Content-Type':'application/json','X-CSRF-Token':this.csrf}:{}),...headers},...(data?{body:JSON.stringify(data)}:{})});const cookie=res.headers.get('set-cookie');if(cookie)this.cookie=cookie.split(';')[0];const raw=await res.text();const body=raw?JSON.parse(raw):null;if(body?.csrfToken)this.csrf=body.csrfToken;return{status:res.status,body,headers:res.headers};}
    async init(){assert.equal((await this.call('/api/session')).status,200);return this;}
    async register(email){await this.init();return this.call('/api/auth/register','POST',{email,name:'Cliente privado',password:'phase3-long-test-password'});}
  }
  return{server,db,env,base,Client,providerCalls:()=>providerCalls,issue(url,patch={}){const params=new URL(url).searchParams;claims={iss:'https://accounts.google.com',aud:env.GOOGLE_CLIENT_ID,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600,nonce:params.get('nonce'),sub:'phase3-subject',email:'google@example.test',email_verified:true,name:'Cliente Google',...patch};return params.get('state');},async signedWebhook(type,id,providerId,patch={}){if(!webhookDates.has(id))webhookDates.set(id,new Date().toISOString());const payload=JSON.stringify({type,created_at:webhookDates.get(id),data:{email_id:providerId}}),timestamp=String(Math.floor(Date.now()/1000)),signature='v1,'+crypto.createHmac('sha256',Buffer.from(env.RESEND_WEBHOOK_SECRET.slice(6),'base64')).update(id+'.'+timestamp+'.'+payload).digest('base64');const response=await fetch(base+'/api/email/webhook/resend',{method:'POST',headers:{'Content-Type':'application/json','svix-id':id,'svix-timestamp':timestamp,'svix-signature':signature,...patch.headers},body:payload+(patch.suffix||'')});return{status:response.status,body:await response.json()};}};
}
test('Fase3 API Google callback aceita cross-site somente com state da própria sessão e gira cookie',async t=>{
  const f=await fixture(t),owner=await new f.Client().init(),stranger=await new f.Client().init();
  const start=await owner.call('/api/auth/google/start','POST',{intent:'login',next:'//evil.example'});assert.equal(start.status,200);const state=f.issue(start.body.url);
  const callbacks=()=>'/api/auth/google/callback?code=fixture-code&state='+state;
  const forged=await stranger.call(callbacks(),'GET',null,{'Sec-Fetch-Site':'cross-site',Origin:'https://accounts.google.com'});assert.equal(forged.status,303);assert.equal(f.providerCalls(),0);assert.equal(forged.headers.get('location'),'/entrar?google=failed');
  const priorCookie=owner.cookie,success=await owner.call(callbacks(),'GET',null,{'Sec-Fetch-Site':'cross-site',Origin:'https://accounts.google.com'});assert.equal(success.status,303);assert.equal(success.headers.get('location'),'/conta');assert.notEqual(owner.cookie,priorCookie);
  const account=await owner.call('/api/account/security');assert.equal(account.status,200);assert.equal(account.body.google.linked,true);assert.equal(account.body.passwordEnabled,false);
  const replay=await owner.call(callbacks(),'GET',null,{'Sec-Fetch-Site':'cross-site'});assert.equal(replay.headers.get('location'),'/entrar?google=failed');assert.equal((await owner.call('/api/account/security')).status,200);
  assert.equal((await owner.call('/api/account/security','GET',null,{'Sec-Fetch-Site':'cross-site',Origin:'https://evil.example'})).status,403);
  const welcome=await f.db.prepare("SELECT status FROM email_outbox WHERE key LIKE 'welcome:%'").get();assert.equal(welcome.status,'SENT','boas-vindas Google precisam ser processadas, não depender de request futuro');
});
test('Fase3 API webhook Resend valida raw Svix sem CSRF, rejeita assinatura/reformat e admin DTO protege dados',async t=>{
  const f=await fixture(t),customer=new f.Client();assert.equal((await customer.register('customer@example.test')).status,201);
  const adminId=crypto.randomUUID();await f.db.prepare("INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?, 'ADMIN',?)").run(adminId,'admin@example.test','Administrador',await hashPassword('phase3-admin-password'),new Date().toISOString());
  const admin=await new f.Client().init();assert.equal((await admin.call('/api/auth/login','POST',{email:'admin@example.test',password:'phase3-admin-password'})).status,200);
  const eventId=crypto.randomUUID(),token='fixture-private-reset-token',payload={key:'phase3/accepted',template:'password-reset',to:'private-recipient@example.test',data:{resetUrl:origin+'/recuperar-senha?token='+token}};
  await f.db.prepare("INSERT INTO email_outbox(id,key,payload_json,status,attempts,next_attempt_at,provider_id,created_at,delivery_status) VALUES(?,?,?,'SENT',1,?,'phase3-provider-accepted',?,'ACCEPTED')").run(eventId,payload.key,JSON.stringify(payload),Date.now(),new Date().toISOString());
  assert.equal((await customer.call('/api/admin/emails')).status,403);assert.equal((await customer.call('/api/admin/emails/'+eventId+'/retry','POST',{})).status,403);
  let listed=await admin.call('/api/admin/emails');assert.equal(listed.status,200);assert.equal(listed.body.items.find(row=>row.id===eventId).deliveryStatus,'ACCEPTED');assert.ok(!JSON.stringify(listed.body).includes(token));assert.ok(!JSON.stringify(listed.body).includes('private-recipient@example.test'));assert.ok(!JSON.stringify(listed.body).includes(f.env.RESEND_WEBHOOK_SECRET));
  assert.equal((await f.signedWebhook('email.delivered','msg_phase3_invalid','phase3-provider-accepted',{headers:{'svix-signature':'v1,Zm9yZ2Vk'}})).status,401);
  assert.equal((await f.signedWebhook('email.delivered','msg_phase3_rawchange','phase3-provider-accepted',{suffix:' '})).status,401);
  const first=await f.signedWebhook('email.delivered','msg_phase3_delivered','phase3-provider-accepted');assert.equal(first.status,200);assert.equal(first.body.duplicate,false);
  const duplicate=await f.signedWebhook('email.delivered','msg_phase3_delivered','phase3-provider-accepted');assert.equal(duplicate.status,200);assert.equal(duplicate.body.duplicate,true);
  listed=await admin.call('/api/admin/emails');assert.equal(listed.body.items.find(row=>row.id===eventId).deliveryStatus,'DELIVERED');
  assert.equal((await admin.call('/api/admin/emails/'+eventId+'/retry','POST',{})).status,409);
});
test('Fase3 API recuperação genérica, token único e logout invalidam apenas sessões próprias',async t=>{
  const f=await fixture(t),owner=new f.Client(),other=new f.Client();assert.equal((await owner.register('owner@example.test')).status,201);assert.equal((await other.register('other@example.test')).status,201);
  const oauthId=crypto.randomUUID();await f.db.prepare("INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,'oauth$google','CUSTOMER',?)").run(oauthId,'oauth@example.test','Google',new Date().toISOString());
  const anonymous=await new f.Client().init(),known=await anonymous.call('/api/auth/forgot-password','POST',{email:'owner@example.test'}),unknown=await anonymous.call('/api/auth/forgot-password','POST',{email:'missing@example.test'}),googleOnly=await anonymous.call('/api/auth/forgot-password','POST',{email:'oauth@example.test'});
  assert.equal(known.status,202);assert.deepEqual(unknown.body,known.body);assert.deepEqual(googleOnly.body,known.body);assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM password_resets WHERE user_id=?').get(oauthId)).n,0);
  const message=JSON.parse((await f.db.prepare("SELECT payload_json FROM email_outbox WHERE key LIKE 'password-reset:%'").get()).payload_json),token=new URL(message.data.resetUrl).searchParams.get('token');assert.equal(new URL(message.data.resetUrl).origin,origin);assert.ok(!JSON.stringify(known.body).includes(token));
  assert.equal((await anonymous.call('/api/auth/reset-password','POST',{token,password:'phase3-recovered-password'})).status,200);assert.equal((await owner.call('/api/account/security')).status,401);assert.equal((await other.call('/api/account/security')).status,200);
  assert.equal((await anonymous.call('/api/auth/reset-password','POST',{token,password:'phase3-another-password'})).status,422);
  await owner.init();assert.equal((await owner.call('/api/auth/login','POST',{email:'owner@example.test',password:'phase3-recovered-password'})).status,200);
  const stale=new f.Client();stale.cookie=owner.cookie;stale.csrf=owner.csrf;assert.equal((await owner.call('/api/auth/logout','POST',{})).status,200);assert.equal((await stale.call('/api/account/security')).status,401);assert.equal((await other.call('/api/account/security')).status,200);
});
test('Fase3 API preferências daily sincronizam consentimento sem modificar outra conta',async t=>{
  const f=await fixture(t),owner=new f.Client(),other=new f.Client();const a=await owner.register('a@example.test'),b=await other.register('b@example.test');assert.equal(a.status,201);assert.equal(b.status,201);
  const updated=await owner.call('/api/account/collection/preferences','PUT',{notifyEmail:true,digest:'daily',userId:b.body.user.id});assert.equal(updated.status,200);assert.equal(updated.body.notifyEmail,true);assert.equal(updated.body.email.wishlistEnabled,true);assert.equal(updated.body.email.digestEnabled,true);
  const theirs=await other.call('/api/account/collection/preferences');assert.equal(theirs.status,200);assert.equal(theirs.body.notifyEmail,false);assert.equal(theirs.body.email.wishlistEnabled,false);
  const before=await owner.call('/api/account/collection/preferences');const rejected=await owner.call('/api/account/collection/preferences','PUT',{notifyEmail:false,digest:'invalid'});assert.equal(rejected.status,422);assert.deepEqual((await owner.call('/api/account/collection/preferences')).body,before.body);
});
