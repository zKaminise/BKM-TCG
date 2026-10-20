const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {openStore}=require('../server/store.cjs');
const {createGoogleAuth,googleReadiness}=require('../server/google-auth.cjs');
const env={BKM_PUBLIC_URL:'https://bkm.example.test',GOOGLE_AUTH_ENABLED:'true',GOOGLE_CLIENT_ID:'fixture-client.apps.googleusercontent.com',GOOGLE_CLIENT_SECRET:'fixture-not-a-real-secret'};
const keys=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...keys.publicKey.export({format:'jwk'}),kid:'test-key',use:'sig',alg:'RS256'};
async function fixture(t) {
  const pg=new PGlite(),db=openStore({pgClient:{query:async(sql,args)=>args?.length?pg.query(sql,args):(await pg.exec(sql)).at(-1),end:()=>pg.close()}});await db.ready;t.after(()=>db.close());
  const stamp=Date.parse('2026-10-19T16:00:00Z');let claims,corruptSignature=false,requests=[];
  const sign=()=>{const parts=[{alg:'RS256',kid:jwk.kid,typ:'JWT'},claims].map(value=>Buffer.from(JSON.stringify(value)).toString('base64url'));const signature=crypto.sign('RSA-SHA256',Buffer.from(parts.join('.')),keys.privateKey);if(corruptSignature)signature[0]^=1;return parts.join('.')+'.'+signature.toString('base64url');};
  const auth=createGoogleAuth({db,env,now:()=>stamp,fetchImpl:async(url,options)=>{requests.push({url,options});if(url.endsWith('/certs'))return new Response(JSON.stringify({keys:[jwk]}));assert.equal(url,'https://oauth2.googleapis.com/token');assert.match(options.body,/code_verifier=/);return new Response(JSON.stringify({id_token:sign()}));}});
  const session={token_hash:crypto.randomBytes(32).toString('hex')};
  return {db,auth,session,requests,async begin(options={}){const result=await auth.start({session,...options});const url=new URL(result.authorizationUrl);claims={iss:'https://accounts.google.com',aud:env.GOOGLE_CLIENT_ID,iat:stamp/1000,exp:stamp/1000+3600,nonce:url.searchParams.get('nonce'),sub:'google-subject-fixture',email:'google-customer@example.test',email_verified:true,name:'Cliente Google'};return {url,state:url.searchParams.get('state')};},override(values){Object.assign(claims,values);},tamper(){corruptSignature=true;},async user(email,role='CUSTOMER'){const user={id:crypto.randomUUID(),email,name:'Conta existente',role};await db.prepare('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)').run(user.id,user.email,user.name,'unusable-fixture',role,new Date(stamp).toISOString());return user;}};
}
test('Google OIDC somente habilita credenciais e callback canônico exato',()=>{
  assert.equal(googleReadiness({}).enabled,false);assert.equal(googleReadiness(env).enabled,true);
  assert.equal(googleReadiness({...env,GOOGLE_REDIRECT_URI:'https://evil.example/callback'}).enabled,false);
  assert.equal(googleReadiness({...env,BKM_PUBLIC_URL:'javascript:evil'}).enabled,false);
});
test('Google OIDC PKCE, state vinculado à sessão e login recorrente preservam usuário próprio',async t=>{
  const f=await fixture(t),begun=await f.begin({returnTo:'//evil.example'});
  assert.equal(begun.url.searchParams.get('scope'),'openid email profile');assert.equal(begun.url.searchParams.get('code_challenge_method'),'S256');assert.equal(begun.url.searchParams.get('redirect_uri'),env.BKM_PUBLIC_URL+'/api/auth/google/callback');
  const saved=await f.db.prepare('SELECT * FROM oauth_states').get();assert.equal(crypto.createHash('sha256').update(saved.code_verifier).digest('base64url'),begun.url.searchParams.get('code_challenge'));assert.notEqual(saved.state_hash,begun.state);
  await assert.rejects(f.auth.finish({session:{token_hash:'other'},state:begun.state,code:'fixture'}),e=>e.code==='GOOGLE_STATE_INVALID');
  const result=await f.auth.finish({session:f.session,state:begun.state,code:'fixture'});assert.equal(result.created,true);assert.equal(result.user.role,'CUSTOMER');assert.equal(result.returnTo,'/conta');
  await assert.rejects(f.auth.finish({session:f.session,state:begun.state,code:'fixture'}),e=>e.code==='GOOGLE_STATE_INVALID');
  const next=await f.begin();f.override({email:'changed-google@example.test'});const returning=await f.auth.finish({session:f.session,state:next.state,code:'fixture'});assert.equal(returning.user.id,result.user.id);assert.equal(returning.user.email,result.user.email);assert.equal(returning.created,false);
});
test('Google OIDC não vincula email existente nem concede ADMIN; vínculo exige sessão da conta',async t=>{
  const f=await fixture(t),user=await f.user('google-customer@example.test'),first=await f.begin();
  await assert.rejects(f.auth.finish({session:f.session,state:first.state,code:'fixture'}),e=>e.code==='GOOGLE_ACCOUNT_LINK_REQUIRED');
  assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM oauth_identities').get()).n,0);
  f.session.user=user;const link=await f.begin({mode:'link'}),result=await f.auth.finish({session:f.session,state:link.state,code:'fixture'});assert.equal(result.linked,true);assert.equal(result.user.id,user.id);
  const admin=await f.user('admin@example.test','ADMIN');await assert.rejects(f.auth.start({session:{token_hash:'adminsession',user:admin},mode:'link'}),e=>e.code==='GOOGLE_ADMIN_LINK_FORBIDDEN');
  const other=await f.user('another@example.test');f.session.user=other;const conflict=await f.begin({mode:'link'});await assert.rejects(f.auth.finish({session:f.session,state:conflict.state,code:'fixture'}),e=>e.code==='GOOGLE_IDENTITY_CONFLICT');
});
test('Google OIDC valida assinatura, issuer, audience, validade, nonce e email verificado no backend',async t=>{
  const f=await fixture(t);
  for(const patch of [{iss:'https://evil.example'},{aud:'other'},{azp:'other'},{exp:1},{iat:9999999999},{nonce:'wrong'},{email_verified:false},{sub:''}]){const start=await f.begin();f.override(patch);await assert.rejects(f.auth.finish({session:f.session,state:start.state,code:'fixture'}),e=>e.code==='GOOGLE_TOKEN_INVALID');}
  const cancelled=await f.begin();await assert.rejects(f.auth.finish({session:f.session,state:cancelled.state,error:'access_denied'}),e=>e.code==='GOOGLE_CANCELLED');
  const expired=await f.begin();await f.db.prepare('UPDATE oauth_states SET expires_at=1 WHERE state_hash=?').run(crypto.createHash('sha256').update(expired.state).digest('hex'));await assert.rejects(f.auth.finish({session:f.session,state:expired.state,code:'fixture'}),e=>e.code==='GOOGLE_STATE_INVALID');
  const forged=await f.begin();f.tamper();await assert.rejects(f.auth.finish({session:f.session,state:forged.state,code:'fixture'}),e=>e.code==='GOOGLE_TOKEN_INVALID');
  assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM users').get()).n,0);
});
